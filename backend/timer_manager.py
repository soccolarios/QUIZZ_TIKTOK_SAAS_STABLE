import asyncio
from typing import Callable, Optional
from datetime import datetime


class TimerManager:
    def __init__(self):
        self.current_timer: Optional[asyncio.Task] = None
        self.start_time: Optional[datetime] = None
        self.duration: int = 0
        self.remaining: int = 0
        self.is_running: bool = False
        self.on_tick: Optional[Callable] = None
        self.on_complete: Optional[Callable] = None
        self._pause_event: asyncio.Event = asyncio.Event()
        self._pause_event.set()

    async def start(self, duration: int, on_tick: Callable = None, on_complete: Callable = None):
        await self.stop()

        self._pause_event.set()

        self.duration = duration
        self.remaining = duration
        self.is_running = True
        self.start_time = datetime.now()
        self.on_tick = on_tick
        self.on_complete = on_complete

        self.current_timer = asyncio.create_task(self._run_timer())

    async def _run_timer(self):
        try:
            elapsed = 0.0
            while self.remaining > 0 and self.is_running:
                await self._pause_event.wait()
                if not self.is_running:
                    break

                if elapsed == 0.0 and self.on_tick:
                    await self._safe_callback(self.on_tick, self.remaining)

                while elapsed < 1.0 and self.is_running:
                    if not self._pause_event.is_set():
                        await self._pause_event.wait()
                        if not self.is_running:
                            break
                        continue
                    await asyncio.sleep(0.1)
                    elapsed += 0.1

                if not self.is_running:
                    break

                if self._pause_event.is_set():
                    self.remaining -= 1
                    elapsed = 0.0

            if self.is_running and self.on_tick:
                await self._safe_callback(self.on_tick, 0)

            if self.is_running and self.on_complete:
                await self._safe_callback(self.on_complete)

            self.is_running = False

        except asyncio.CancelledError:
            self.is_running = False
        except Exception as e:
            print(f"[TimerManager] Error: {e}")
            self.is_running = False

    async def _safe_callback(self, callback: Callable, *args):
        try:
            result = callback(*args)
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:
            print(f"[TimerManager] Callback error: {e}")

    async def stop(self):
        self.is_running = False
        self._pause_event.set()
        if self.current_timer and not self.current_timer.done():
            self.current_timer.cancel()
            try:
                await self.current_timer
            except asyncio.CancelledError:
                pass
        self.current_timer = None

    def pause(self):
        self._pause_event.clear()
        print(f"[TimerManager] Paused with {self.remaining}s remaining")

    def resume(self):
        if self.remaining > 0:
            self._pause_event.set()
            print(f"[TimerManager] Resumed with {self.remaining}s remaining")

    def is_paused(self) -> bool:
        return not self._pause_event.is_set()

    def get_remaining(self) -> int:
        return max(0, self.remaining)

    def get_elapsed(self) -> int:
        return self.duration - self.remaining

    def get_elapsed_ms(self) -> int:
        if self.start_time:
            elapsed = (datetime.now() - self.start_time).total_seconds() * 1000
            return int(elapsed)
        return 0

    def is_active(self) -> bool:
        return self.is_running and self.remaining > 0


class CountdownTimer(TimerManager):
    def __init__(self, message_format: str = "Prochaine question dans {seconds} secondes"):
        super().__init__()
        self.message_format = message_format

    def get_message(self) -> str:
        return self.message_format.format(seconds=self.remaining)
