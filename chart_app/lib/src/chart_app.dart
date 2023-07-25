import 'package:chart_app/src/helpers/chart.dart';
import 'package:chart_app/src/interop/js_interop.dart';
import 'package:chart_app/src/misc/wrapped_controller.dart';
import 'package:chart_app/src/models/chart_config.dart';
import 'package:chart_app/src/models/chart_feed.dart';
import 'package:chart_app/src/models/indicators.dart';
import 'package:deriv_chart/deriv_chart.dart';
import 'package:flutter/material.dart';

/// ChartApp
class ChartApp {
  /// Constructor
  ChartApp(
    this.configModel,
    this.feedModel,
    this.indicatorsModel,
  );

  /// ChartConfigModel
  ChartConfigModel configModel;

  /// ChartFeedModel
  ChartFeedModel feedModel;

  /// Indicators config
  IndicatorsModel indicatorsModel;

  /// WrappedController
  WrappedController wrappedController = WrappedController();

  bool _prevShowChart = false;

  /// width of yAxis
  double yAxisWidth = 60;

  /// Whether chart is mounted or not.
  bool isMounted = false;

  void _processChartVisibilityChange(bool showChart) {
    yAxisWidth = calculateYAxisWidth(
      feedModel.ticks,
      configModel.theme,
      configModel.pipSize,
    );

    if (showChart) {
      /// To prevent controller functions being called before mount.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        isMounted = true;
      });
    } else {
      isMounted = false;
    }
  }

  /// Gets the chart visibility
  bool getChartVisibilitity() {
    final bool showChart = feedModel.isFeedLoaded;

    if (showChart != _prevShowChart) {
      _processChartVisibilityChange(showChart);
    }

    _prevShowChart = showChart;
    return showChart;
  }

  /// Initialize new chart
  void newChart(JSNewChart payload) {
    configModel.newChart(payload);
    feedModel.newChart();
  }

  /// Gets the tooltip content for indicator series
  List<JsIndicatorTooltip?>? getTooltipContent(int epoch, int pipSize) {
    final List<Series> seriesList =
        wrappedController.getSeriesList() ?? <Series>[];
    final List<IndicatorConfig> indicatorConfigsList =
        wrappedController.getConfigsList() as List<IndicatorConfig>? ??
            <IndicatorConfig>[];

    return indicatorsModel.getTooltipContent(
      seriesList,
      indicatorConfigsList,
      epoch,
      pipSize,
    );
  }

  /// Gets the quote interval as granularity to fix 2s ticks.
  int? getQuotesInterval() {
    if (feedModel.isFeedLoaded && feedModel.ticks.length > 1) {
      final Tick previousTick = feedModel.ticks[feedModel.ticks.length - 2];
      final Tick lastTick = feedModel.ticks.last;
      if (previousTick.epoch != lastTick.epoch) {
        return feedModel.ticks.last.epoch - previousTick.epoch;
      }
    }
    return configModel.granularity;
  }

  /// Gets the hover index for indicator series
  int? getIndicatorHoverIndex(
      double x, double y, Function getClosestEpoch, int granularity) {
    final List<Series> seriesList =
        wrappedController.getChartController().getSeriesList?.call() ??
            <Series>[];
    final List<IndicatorConfig> indicatorConfigsList =
        wrappedController.getChartController().getConfigsList != null
            ? wrappedController.getChartController().getConfigsList!.call()
                as List<IndicatorConfig>
            : <IndicatorConfig>[];

    return indicatorsModel.getIndicatorHoverIndex(
      seriesList,
      indicatorConfigsList,
      wrappedController,
      getClosestEpoch,
      granularity,
      x,
      y,
    );
  }
}
