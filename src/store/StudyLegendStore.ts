import { action, observable, reaction, when, makeObservable } from 'mobx';
import React from 'react';
import set from 'lodash.set';
import Context from 'src/components/ui/Context';
import { getUniqueId, hexToInt } from 'src/components/ui/utils';
import { TActiveItem, TIndicatorConfig, TSettingsParameter } from 'src/types';
import MainStore from '.';
import { IndicatorCatTrendDarkIcon, IndicatorCatTrendLightIcon } from '../components/Icons';
import { getIndicatorsTree, getDefaultIndicatorConfig } from '../Constant';
import { clone, flatMap, isLiteralObject, prepareIndicatorName, transformStudiesforTheme } from '../utils';
import { LogActions, LogCategories, logEvent } from '../utils/ga';
import MenuStore from './MenuStore';
import SettingsDialogStore from './SettingsDialogStore';

export default class StudyLegendStore {
    mainStore: MainStore;
    menuStore: MenuStore;
    searchInput: React.RefObject<HTMLInputElement>;
    settingsDialog: SettingsDialogStore;
    selectedTab = 1;
    filterText = '';
    activeItems: TActiveItem[] = [];
    infoItem: (TActiveItem & { disabledAddBtn?: boolean }) | null = null;
    portalNodeIdChanged? = '';

    constructor(mainStore: MainStore) {
        makeObservable(this, {
            selectedTab: observable,
            filterText: observable,
            activeItems: observable,
            infoItem: observable,
            portalNodeIdChanged: observable,
            onSelectItem: action.bound,
            updateStyle: action.bound,
            updateProps: action.bound,
            editStudy: action.bound,
            editStudyByIndex: action.bound,
            deleteStudy: action.bound,
            deleteStudyById: action.bound,
            updateStudy: action.bound,
            deletePredictionStudies: action.bound,
            deleteAllStudies: action.bound,
            onSelectTab: action.bound,
            setFilterText: action.bound,
            onInfoItem: action.bound,
            updatePortalNode: action.bound,
        });

        this.mainStore = mainStore;
        when(() => !!this.context, this.onContextReady);
        this.menuStore = new MenuStore(mainStore, { route: 'indicators' });
        this.settingsDialog = new SettingsDialogStore({
            mainStore,
            onDeleted: this.deleteStudyById,
            favoritesId: 'indicators',
            onChanged: (items: TSettingsParameter[]) => this.updateStudy(items),
        });
        this.searchInput = React.createRef();
        reaction(
            () => this.menuStore.open,
            () => {
                if (!this.menuStore.open) {
                    this.setFilterText('');
                }
                setTimeout(() => {
                    if (this.searchInput && this.searchInput.current) this.searchInput.current.focus();
                }, 400);
            }
        );
    }
    searchInputClassName?: string;

    onContextReady = () => {
        // to remove studies if user has already more than 5

        this.renderLegend();
    };
    get context(): Context | null {
        return this.mainStore.chart.context;
    }

    get indicatorRatio() {
        return this.mainStore.chart;
    }
    get items() {
        return [...getIndicatorsTree()].map(indicator => {
            // the only icon which is different on light/dark is trend
            if (indicator.name === 'trend') {
                indicator.icon =
                    this.mainStore.chartSetting.theme === 'light'
                        ? IndicatorCatTrendLightIcon
                        : IndicatorCatTrendDarkIcon;
            }
            return indicator;
        });
    }
    get searchedItems() {
        return [...getIndicatorsTree()]
            .map(category => {
                category.foundItems = (category.items.filter(
                    item => item.flutter_chart_id.toLowerCase().indexOf(this.filterText.toLowerCase().trim()) !== -1
                ) as unknown) as TActiveItem[];
                return category;
            })
            .filter(category => category.foundItems?.length);
    }

    get hasPredictionIndicator() {
        return (this.activeItems || []).filter((item: TActiveItem) => item.isPrediction).length > 0;
    }

    get maxAllowedItem() {
        return this.mainStore.chart.isMobile ? 2 : 5;
    }

    transform = (value: any) => {
        if (typeof value == 'string' && (value.startsWith('#') || value.toLowerCase().startsWith('0x'))) {
            return hexToInt(value);
        } else if (isLiteralObject(value)) {
            const map = value as Record<string, any>;
            Object.keys(value).forEach(key => {
                map[key] = this.transform(map[key]);
            });
        } else if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                value[i] = this.transform(value[i]);
            }
        }

        return value;
    };

    addOrUpdateIndicator = (activeItem: TActiveItem, index?: number) => {
        const params = activeItem.parameters.reduce((acc, item) => {
            const { path, paths, value } = item;

            if (isLiteralObject(value) && paths) {
                const map = value as Record<string, any>;
                const keys = Object.keys(map);
                keys.forEach(key => {
                    set(acc, paths[key], map[key]);
                });
            } else if (path) {
                set(acc, path, value);
            }

            return acc;
        }, activeItem.config || {});

        const config: TIndicatorConfig = {
            id: activeItem.id,
            name: activeItem.flutter_chart_id,
            title: (activeItem.shortname + (activeItem.bars ? ` (${activeItem.bars})` : '')).toUpperCase(),
            ...this.transform(params),
        };

        this.mainStore.chartAdapter.flutterChart?.indicators.addOrUpdateIndicator(JSON.stringify(config), index);
    };

    onSelectItem(indicatorName: string) {
        this.onInfoItem(null);

        if (this.activeItems.length >= this.maxAllowedItem) return;

        this.changeStudyPanelTitle();
        logEvent(LogCategories.ChartControl, LogActions.Indicator, `Add ${indicatorName}`);

        const props = this.getIndicatorProps(indicatorName);
        const { parameters, config } = getDefaultIndicatorConfig(indicatorName);

        if (props && parameters) {
            parameters.map(p => (p.value = clone(p.defaultValue)));
            const nameObj = prepareIndicatorName(this.settingsDialog.flutter_chart_id, parameters);

            const item: TActiveItem = {
                ...props,
                id: getUniqueId(),
                config,
                parameters,
                bars: nameObj.bars,
            };

            transformStudiesforTheme(parameters, this.mainStore.chartSetting.theme);

            this.addOrUpdateIndicator(item);
            this.activeItems.push(item);

            this.mainStore.bottomWidgetsContainer.updateChartHeight();
            this.mainStore.state.saveLayout();
        }
    }

    async restoreStudies(activeItems: TActiveItem[]) {
        this.deleteAllStudies();

        activeItems.forEach(activeItem => {
            this.addOrUpdateIndicator(activeItem);

            const props = this.getIndicatorProps(activeItem.flutter_chart_id);
            Object.assign(activeItem, props || {});
        });

        this.activeItems = activeItems;

        this.mainStore.bottomWidgetsContainer.updateChartHeight();
    }

    updateTheme() {
        this.activeItems.forEach((activeItem, index) => {
            transformStudiesforTheme(activeItem.parameters, this.mainStore.chartSetting.theme);
            this.addOrUpdateIndicator(activeItem, index);
        });
        this.mainStore.state.saveLayout();
    }

    // Temporary prevent user from adding more than 5 indicators
    // TODO All traces can be removed after new design for studies
    updateStyle() {
        const should_minimise_last_digit = this.mainStore.studies.activeItems.length > 2;
        this.mainStore.state.setShouldMinimiseLastDigit(should_minimise_last_digit);
    }
    updateProps({ searchInputClassName }: { searchInputClassName?: string }) {
        this.searchInputClassName = searchInputClassName;
    }

    editStudyByIndex(index: number) {
        const activeItem = this.activeItems[index];
        if (activeItem) this.editStudy(activeItem);
    }

    editStudy(study: TActiveItem) {
        logEvent(LogCategories.ChartControl, LogActions.Indicator, `Edit ${study.flutter_chart_id}`);

        this.settingsDialog.id = study.id;
        this.settingsDialog.flutter_chart_id = study.flutter_chart_id;
        this.settingsDialog.items = study.parameters;
        this.settingsDialog.title = study.name;
        this.settingsDialog.formTitle = t.translate('Result');
        this.settingsDialog.formClassname = `form--${study.id.toLowerCase().replace(/ /g, '-')}`;
        // TODO:
        // const description = StudyInfo[study.sd.type];
        // this.settingsDialog.description = description || t.translate("No description yet");
        this.settingsDialog.description = '';
        this.settingsDialog.dialogPortalNodeId = this.portalNodeIdChanged;
        this.settingsDialog.setOpen(true);
    }
    deleteStudyById(id: string) {
        const index = this.activeItems.findIndex(item => item.id === id);
        this.mainStore.chartAdapter.flutterChart?.indicators.removeIndicator(index);
        this.deleteStudy(index);
    }
    deleteStudy(index: number) {
        logEvent(LogCategories.ChartControl, LogActions.Indicator, `Remove ${index}`);

        this.activeItems.splice(index, 1);
        this.mainStore.bottomWidgetsContainer.updateChartHeight();
        this.renderLegend();
        this.mainStore.state.saveLayout();
    }
    updateStudy(parameters: TSettingsParameter[]) {
        this.changeStudyPanelTitle();

        const props = this.getIndicatorProps(this.settingsDialog.flutter_chart_id);
        const { config } = getDefaultIndicatorConfig(this.settingsDialog.flutter_chart_id) || {};

        if (props && parameters) {
            const nameObj = prepareIndicatorName(this.settingsDialog.flutter_chart_id, parameters);

            const item: TActiveItem = {
                ...props,
                id: this.settingsDialog.id,
                bars: nameObj.bars,
                parameters,
                config,
            };

            const index = this.activeItems.findIndex(item => item.id === this.settingsDialog.id);
            this.activeItems[index] = item;

            this.addOrUpdateIndicator(item, index);
            this.mainStore.state.saveLayout();
        }
    }
    changeStudyPanelTitle() {
        // Remove numbers from the end of indicator titles in mobile
        if (this.mainStore.chart.isMobile) {
            this.mainStore.state.saveLayout();
        }
    }

    /**
     * Gets called continually in the draw animation loop.
     * Be careful not to render unnecessarily. */
    renderLegend = () => {
        if (!this.context) {
            return;
        }
        // Temporary prevent user from adding more than 5 indicators
        // All traces can be removed after new design for studies
        this.updateStyle();
    };

    getIndicatorProps = (indicator: string) => {
        return flatMap(getIndicatorsTree(), collection => collection.items).find(
            item => item?.flutter_chart_id === indicator
        );
    };

    deletePredictionStudies() {
        this.deleteAllStudies();
    }

    deleteAllStudies() {
        this.activeItems = [];
        window.flutterChart?.indicators.clearIndicators();
        this.mainStore.state.saveLayout();
    }

    onSelectTab(tabIndex: number) {
        this.setFilterText('');
        this.selectedTab = tabIndex;
        this.onInfoItem(null);
    }
    setFilterText(filterText: string) {
        this.selectedTab = filterText !== '' ? 0 : 1;
        this.filterText = filterText;
    }

    onInfoItem(study: TActiveItem | null) {
        this.infoItem = study
            ? {
                  ...study,
                  disabledAddBtn: study.isPrediction && this.mainStore.timeperiod.isTick,
              }
            : study;
    }
    updatePortalNode(portalNodeId?: string) {
        this.portalNodeIdChanged = portalNodeId;
    }
}
