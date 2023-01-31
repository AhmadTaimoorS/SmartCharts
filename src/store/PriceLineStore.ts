import EventEmitter from 'event-emitter-es6';
import { action, computed, observable, when, makeObservable, reaction, IReactionDisposer } from 'mobx';
import Context from 'src/components/ui/Context';
import MainStore from '.';
import { ARROW_HEIGHT, DIRECTIONS, makeElementDraggable } from '../utils';

const LINE_OFFSET_HEIGHT = 4;
const LINE_OFFSET_HEIGHT_HALF = LINE_OFFSET_HEIGHT >> 1;

export default class PriceLineStore {
    __top = 0;
    _emitter: EventEmitter;
    _line?: HTMLElement;
    _priceConstrainer: number | ((val: number) => number) = 0;
    _startDragPrice = '0';
    className?: string;
    hideBarrierLine?: boolean;
    hideOffscreenLine?: boolean;
    mainStore: MainStore;
    opacityOnOverlap = 0;
    showOffscreenArrows = false;
    _relative = false;
    draggable = true;
    isDragging = false;
    visible = true;
    _price = '0';
    _dragPrice = '0';
    offScreen = false;
    title?: string;
    isOverlapping = false;
    offScreenDirection: keyof typeof DIRECTIONS | null = null;
    disposeDrawReaction?: IReactionDisposer;

    set zIndex(value: string | number | null) {
        if (this._line && value) {
            this._line.style.zIndex = value.toString();
        }
    }

    get pip() {
        return this.mainStore.chart.currentActiveSymbol?.decimal_places as number;
    }

    constructor(mainStore: MainStore) {
        makeObservable(this, {
            draggable: observable,
            isDragging: observable,
            visible: observable,
            _price: observable,
            _dragPrice: observable,
            offScreen: observable,
            title: observable,
            isOverlapping: observable,
            offScreenDirection: observable,
            pip: computed,
            priceDisplay: computed,
            setDragLine: action.bound,
            _startDrag: action.bound,
            _dragLine: action.bound,
            _endDrag: action.bound,
            _calculateTop: action.bound,
        });

        this.mainStore = mainStore;
        this._emitter = new EventEmitter({ emitDelay: 0 });
        when(() => this.mainStore.chartAdapter.isChartLoaded, this.onChartLoaded);
    }

    onChartLoaded = () => {
        this.disposeDrawReaction = reaction(
            () => [this.mainStore.chartAdapter.epochBounds, this.mainStore.chartAdapter.quoteBounds],
            () => {
                if (!this.isDragging) {
                    this._draw();
                }
            }
        );
    };

    destructor() {
        this.disposeDrawReaction?.();
    }

    init = () => {
        const exitIfNotisDraggable = (e: MouseEvent, callback: (event: MouseEvent) => void) => {
            if (this.visible && this.draggable) {
                callback.call(this, e);
            }
        };

        const subholder: HTMLElement | null = document.querySelector('.cq-inchart-subholder');

        if (this._line && subholder) {
            makeElementDraggable(this._line, subholder, {
                onDragStart: (e: MouseEvent) => exitIfNotisDraggable(e, this._startDrag),
                onDrag: (e: MouseEvent) => exitIfNotisDraggable(e, e => this._dragLine(e, subholder)),
                onDragReleased: (e: MouseEvent) => exitIfNotisDraggable(e, this._endDrag),
            });
        }
    };

    static get EVENT_PRICE_CHANGED() {
        return 'EVENT_PRICE_CHANGED';
    }
    static get EVENT_DRAG_RELEASED() {
        return 'EVENT_DRAG_RELEASED';
    }

    get priceDisplay() {
        let display = this.isDragging ? Number(this.dragPrice).toFixed(this.pip) : this._price;
        if (this.relative && +this._price > 0 && display[0] !== '+') {
            display = `+${display}`;
        }
        return display;
    }

    get price() {
        return this._price;
    }

    set price(value) {
        if (value !== this._price && !this.isDragging) {
            this._price = value;
            this._draw();
            this._emitter.emit(PriceLineStore.EVENT_PRICE_CHANGED, this._price);
        }
    }

    get dragPrice() {
        return this._dragPrice;
    }

    set dragPrice(value) {
        if (value != this._dragPrice) {
            this._dragPrice = value;
            this._draw();
            this._emitter.emit(PriceLineStore.EVENT_PRICE_CHANGED, this._dragPrice);
        }
    }

    get relative() {
        return this._relative;
    }

    set relative(value) {
        if (this._relative === value) {
            return;
        }

        this._relative = value;
        // convert between relative and absolute
        const currentQuote = this.mainStore.chart.currentCloseQuote();
        let currentPrice = currentQuote ? currentQuote.Close : 0;
        if (this._relative) {
            currentPrice = -currentPrice;
        }
        this.price = (+this._price + currentPrice).toString();
    }

    get context(): Context | null {
        return this.mainStore.chart.context;
    }

    set priceConstrainer(value: number | ((val: number) => number)) {
        this._priceConstrainer = value;
    }

    get realPrice(): string {
        const price = this.isDragging ? this.dragPrice : this.price;

        const real_price = this.relative
            ? (this.mainStore.chart.currentCloseQuote()?.Close as number) + Number(price)
            : Number(price);
        return real_price.toString();
    }

    get yAxiswidth() {
        return this.mainStore.chart.yAxiswidth;
    }

    setDragLine(el: HTMLDivElement) {
        this._line = el;
        if (this._line) {
            this._draw();
        }
    }

    _startDrag = () => {
        this.isDragging = true;

        this.mainStore.chart.isBarrierDragging = true;
        this.dragPrice = this.price;
        this._startDragPrice = this._price;
    };

    _dragLine = (e: MouseEvent, zone: HTMLElement) => {
        if (!this._line) {
            return;
        }
        const { top } = zone.getBoundingClientRect();
        const newTop = e.pageY - top;
        const newCenter = newTop && newTop + LINE_OFFSET_HEIGHT_HALF;
        let newPrice = newCenter && this._priceFromLocation(newCenter);

        if (typeof this._priceConstrainer === 'function') {
            newPrice = this._priceConstrainer(newPrice);
        }
        if (this.relative) {
            newPrice -= this.mainStore.chart.currentClose as number;
        }

        this.dragPrice = `${newPrice}`;
    };

    _endDrag = () => {
        this.isDragging = false;
        this.mainStore.chart.isBarrierDragging = false;

        if (Number(this._startDragPrice).toFixed(this.pip) !== Number(this.dragPrice).toFixed(this.pip)) {
            this.price = this.dragPrice;
            this._emitter.emit(PriceLineStore.EVENT_DRAG_RELEASED, this._price);
        }
    };

    _locationFromPrice(p: number) {
        return this.mainStore.chartAdapter.getYFromQuote(p);
    }

    _priceFromLocation(y: number) {
        return this.mainStore.chartAdapter.getQuoteFromY(y);
    }

    _calculateTop = () => {
        if (this.mainStore.chart.currentCloseQuote() === null || !this.mainStore.chartAdapter.isChartLoaded) {
            return;
        }

        let top = this._locationFromPrice(+this.realPrice);

        // @ts-ignore
        const height = window.flutterChartElement?.clientHeight || 0;

        // keep line on chart even if price is off viewable area:
        if (top < 0) {
            // this.uncentered = true;
            if (top < -LINE_OFFSET_HEIGHT_HALF) {
                this.offScreenDirection = DIRECTIONS.UP as 'UP';
            }
            top = 0;
        } else if (top + LINE_OFFSET_HEIGHT > height) {
            // this.uncentered = true;
            if (top + LINE_OFFSET_HEIGHT - height > LINE_OFFSET_HEIGHT_HALF) {
                this.offScreenDirection = DIRECTIONS.DOWN as 'DOWN';
            }
            top = height - LINE_OFFSET_HEIGHT;
        } else {
            // this.uncentered = false;
            this.offScreenDirection = null;
        }
        this.offScreen = !!this.offScreenDirection;

        if (top + 30 > height) {
            top = height - 30;
        } else if (top < 10) {
            top = 10;
        }

        if (this.offScreenDirection && this.showOffscreenArrows) {
            top += this.offScreenDirection === DIRECTIONS.UP ? +ARROW_HEIGHT : -ARROW_HEIGHT;
        }

        if (this.opacityOnOverlap) {
            this.isOverlapping = this.overlapCheck(top);
        }

        return Math.round(top) | 0;
    };

    // Mantually update the top to improve performance.
    // We don't pay for react reconciler and mobx observable tracking in animation frames.
    set top(v) {
        this.__top = v;
        if (this._line) {
            this._line.style.transform = `translateY(${this.top - 13}px)`;
        }
    }
    get top() {
        return this.__top;
    }

    _draw = () => {
        if (this.visible && this._line) {
            this.top = this._calculateTop() as number;
        }
    };

    onPriceChanged(callback: EventListener) {
        this._emitter.on(PriceLineStore.EVENT_PRICE_CHANGED, callback);
    }

    onDragReleased(callback: EventListener) {
        this._emitter.on(PriceLineStore.EVENT_DRAG_RELEASED, callback);
    }

    overlapCheck(top: number) {
        const { _barriers } = this.mainStore.chart;

        const filtered_barriers = _barriers.filter(a => +a._high_barrier.price !== 0);
        const current_barrier_idx = filtered_barriers.findIndex(b => b._high_barrier === this);

        for (let i = 0; i < filtered_barriers.length; i++) {
            if (i === current_barrier_idx) {
                continue;
            }

            const barrier = filtered_barriers[i];
            const diffTop = barrier._high_barrier.top && Math.abs(barrier._high_barrier.top - top);

            if (diffTop && diffTop < 25) {
                return true;
            }
        }

        return false;
    }
}
