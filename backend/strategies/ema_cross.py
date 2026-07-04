"""
EMA-cross strategy using Nautilus Trader's native Strategy class.

Goes long when the fast EMA crosses above the slow EMA, short when it
crosses below, flipping the net position on each crossover. Works in both
backtest and live contexts — the strategy only sees quote ticks.
"""

from decimal import Decimal

from nautilus_trader.config import StrategyConfig
from nautilus_trader.indicators import ExponentialMovingAverage
from nautilus_trader.model.data import QuoteTick
from nautilus_trader.model.enums import OrderSide, PriceType
from nautilus_trader.model.identifiers import InstrumentId
from nautilus_trader.model.instruments import Instrument
from nautilus_trader.model.orders import MarketOrder
from nautilus_trader.trading.strategy import Strategy


class EMACrossConfig(StrategyConfig, frozen=True):
    instrument_id: InstrumentId
    fast_period: int = 10
    slow_period: int = 20
    trade_size: Decimal = Decimal(100_000)


class EMACross(Strategy):
    def __init__(self, config: EMACrossConfig) -> None:
        super().__init__(config)
        # MID price — quote ticks carry bid/ask, not a last-trade price.
        self.fast_ema = ExponentialMovingAverage(config.fast_period, price_type=PriceType.MID)
        self.slow_ema = ExponentialMovingAverage(config.slow_period, price_type=PriceType.MID)
        self.instrument: Instrument | None = None

    def on_start(self) -> None:
        self.instrument = self.cache.instrument(self.config.instrument_id)
        if self.instrument is None:
            self.log.error(f"Instrument {self.config.instrument_id} not found in cache")
            self.stop()
            return

        # Indicators are updated automatically from the subscribed tick stream.
        self.register_indicator_for_quote_ticks(self.config.instrument_id, self.fast_ema)
        self.register_indicator_for_quote_ticks(self.config.instrument_id, self.slow_ema)
        self.subscribe_quote_ticks(self.config.instrument_id)

    def on_quote_tick(self, tick: QuoteTick) -> None:
        if not self.slow_ema.initialized:
            return  # Warm-up period

        instrument_id = self.config.instrument_id
        fast_above = self.fast_ema.value > self.slow_ema.value

        if self.portfolio.is_flat(instrument_id):
            self.buy() if fast_above else self.sell()
        elif self.portfolio.is_net_long(instrument_id) and not fast_above:
            self.close_all_positions(instrument_id)
            self.sell()
        elif self.portfolio.is_net_short(instrument_id) and fast_above:
            self.close_all_positions(instrument_id)
            self.buy()

    def buy(self) -> None:
        order: MarketOrder = self.order_factory.market(
            instrument_id=self.config.instrument_id,
            order_side=OrderSide.BUY,
            quantity=self.instrument.make_qty(self.config.trade_size),
        )
        self.submit_order(order)

    def sell(self) -> None:
        order: MarketOrder = self.order_factory.market(
            instrument_id=self.config.instrument_id,
            order_side=OrderSide.SELL,
            quantity=self.instrument.make_qty(self.config.trade_size),
        )
        self.submit_order(order)

    def on_stop(self) -> None:
        self.cancel_all_orders(self.config.instrument_id)
        self.close_all_positions(self.config.instrument_id)

    def on_reset(self) -> None:
        self.fast_ema.reset()
        self.slow_ema.reset()
