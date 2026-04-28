import asyncio
import json
import threading
import time
import uuid
from typing import Set, Dict, Any
import websockets
from websockets.server import WebSocketServerProtocol
import config_loader as cfg


class WebSocketServer:
    def __init__(self, host: str = None, port: int = None):
        ws_cfg = cfg.get_section('websocket')
        self.host = host if host is not None else ws_cfg.get('host', 'localhost')
        self.port = port if port is not None else ws_cfg.get('port', 8765)
        self.clients: Set[WebSocketServerProtocol] = set()
        self.server = None
        self._running = False
        self._audio_ended_event: threading.Event = threading.Event()
        self._audio_play_count = 0
        self._audio_ended_count = 0
        self._audio_token = 0
        self._audio_token_received = False
        self._current_audio_sequence: str | None = None
        self._on_client_connect = None
        self._timeline_t0 = None
        self._session_label = "?"

    def _tl(self, event: str):
        if self._timeline_t0 is not None:
            elapsed = time.monotonic() - self._timeline_t0
            print(f"[Timeline][session:{self._session_label}] +{elapsed:.2f}s {event}")
        else:
            print(f"[Timeline][session:{self._session_label}] {event}")

    async def start(self):
        ws_cfg = cfg.get_section('websocket')
        print(f"[WebSocket] Binding websocket server on {self.host}:{self.port}")
        self.server = await websockets.serve(
            self._handle_client,
            self.host,
            self.port,
            ping_interval=ws_cfg.get('ping_interval', 20),
            ping_timeout=ws_cfg.get('ping_timeout', 10),
            compression=None
        )
        self._running = True
        self._tl("WS bound")
        print(f"[WebSocket] Server bound and listening on ws://{self.host}:{self.port}")

    async def _handle_client(self, websocket: WebSocketServerProtocol, path: str = None):
        self.clients.add(websocket)
        client_id = id(websocket)
        print(f"[WebSocket] Client connected (ID: {client_id}, Total: {len(self.clients)})")

        try:
            await self.send_to_client(websocket, "connected", {
                "message": "Connected to Quiz Game Server",
                "client_id": client_id
            })

            if self._on_client_connect:
                try:
                    snapshot = await self._on_client_connect()
                    if snapshot:
                        await self.send_to_client(websocket, "state_sync", snapshot)
                except Exception as e:
                    print(f"[WebSocket] on_client_connect error: {e}")

            async for message in websocket:
                try:
                    data = json.loads(message)
                    await self._handle_message(websocket, data)
                except json.JSONDecodeError:
                    print(f"[WebSocket] Invalid JSON from client {client_id}")

        except (websockets.ConnectionClosed, websockets.exceptions.WebSocketException):
            print(f"[WebSocket] Client {client_id} disconnected")
        except Exception as e:
            print(f"[WebSocket] Client {client_id} error: {e}")
        finally:
            self.clients.discard(websocket)
            print(f"[WebSocket] Clients remaining: {len(self.clients)}")

    async def _handle_message(self, websocket: WebSocketServerProtocol, data: Dict):
        msg_type = data.get("type", "unknown")
        print(f"[WebSocket] Received: {msg_type}")

        if msg_type == "ping":
            await self.send_to_client(websocket, "pong", {})
        elif msg_type == "audio_ended":
            msg_data = data.get("data", data)
            token = msg_data.get("token")
            sequence_id = msg_data.get("sequence_id")
            self._audio_ended_count += 1
            print(f"[WebSocket] audio_ended received (token={token}, sequence_id={sequence_id}, current_seq={self._current_audio_sequence}, expected_token={self._audio_token})")
            if sequence_id is not None and sequence_id != self._current_audio_sequence:
                print(f"[WebSocket] audio_ended IGNORED — stale sequence_id={sequence_id} (current={self._current_audio_sequence})")
                return
            if token is not None and token == self._audio_token and not self._audio_token_received:
                self._audio_token_received = True
                print(f"[WebSocket] audio_ended accepted (sequence_id={sequence_id}, token={token})")
                self._audio_ended_event.set()
            elif token is None and self._audio_play_count > 0 and self._audio_ended_count >= self._audio_play_count:
                self._audio_ended_event.set()

    async def send_to_client(self, websocket: WebSocketServerProtocol, msg_type: str, data: Dict):
        try:
            message = json.dumps({
                "type": msg_type,
                "data": data
            }, ensure_ascii=False)
            await websocket.send(message)
        except (websockets.ConnectionClosed, websockets.exceptions.WebSocketException):
            self.clients.discard(websocket)
        except Exception as e:
            print(f"[WebSocket] Send error: {e}")
            self.clients.discard(websocket)

    async def broadcast(self, msg_type: str, data: Dict[str, Any]):
        if not self.clients:
            return

        message = json.dumps({
            "type": msg_type,
            "data": data
        }, separators=(',', ':'), ensure_ascii=False)

        snapshot = frozenset(self.clients)
        disconnected: Set[WebSocketServerProtocol] = set()

        async def _send(client):
            try:
                await client.send(message)
            except (websockets.ConnectionClosed, websockets.exceptions.WebSocketException):
                disconnected.add(client)
            except Exception as e:
                print(f"[WebSocket] Broadcast error for client {id(client)}: {e}")
                disconnected.add(client)

        await asyncio.gather(*[_send(c) for c in snapshot], return_exceptions=True)

        if disconnected:
            self.clients -= disconnected

    async def send_game_start(self, total_questions: int):
        await self.broadcast("game_start", {
            "total_questions": total_questions,
            "message": "Le quiz commence!"
        })

    async def send_question(self, question_num: int, total: int, question_data: Dict):
        data = {
            "question_number": question_num,
            "total_questions": total,
            "text": question_data["text"],
            "choices": question_data["choices"],
            "time_limit": question_data.get("time_limit", 20),
            "is_double": question_data.get("is_double", False),
            "questionnaire_name": question_data.get("questionnaire_name", ""),
        }
        await self.broadcast("question", data)

    async def send_timer(self, remaining: int):
        await self.broadcast("timer", {
            "remaining": remaining
        })

    async def send_answer_update(self, counts: Dict[str, int], percentages: Dict[str, float], total: int):
        await self.broadcast("answer_update", {
            "counts": counts,
            "percentages": percentages,
            "total_answers": total
        })

    async def send_result(self, correct_answer: str, answer_text: str,
                          counts: Dict, percentages: Dict, winners: list,
                          fastest_winner=None, total_answers: int = 0,
                          extra: Dict = None):
        data = {
            "correct_letter": correct_answer,
            "correct_answer": correct_answer,
            "correct_text": answer_text,
            "answer_text": answer_text,
            "counts": counts,
            "percentages": percentages,
            "winners": [
                {
                    "username": w.get("display_name", w.get("username")),
                    "display_name": w.get("display_name", w.get("username")),
                    "points": w.get("points", 0),
                    "time_ms": w.get("time_ms", 0),
                    "profile_picture_url": w.get("profile_picture_url", "")
                }
                for w in winners[:10]
            ],
            "winner_count": len(winners),
            "total_winners": len(winners),
            "fastest_winner": fastest_winner,
            "total_correct": len(winners),
            "total_answers": total_answers
        }
        if extra:
            data.update(extra)
        await self.broadcast("result", data)

    async def send_leaderboard(self, leaderboard: list):
        players = [
            {
                "username": p.get("username", ""),
                "score": p.get("score", 0),
                "rank": p.get("rank", 0),
                "profile_picture_url": p.get("profile_picture_url", "")
            }
            for p in leaderboard[:10]
        ]
        await self.broadcast("leaderboard", {"players": players})

    async def send_countdown(self, seconds: int):
        await self.broadcast("countdown", {
            "seconds": seconds,
            "message": f"Prochaine question dans {seconds}s"
        })

    async def send_next_question(self):
        await self.broadcast("next_question", {})

    async def send_questionnaire_transition(self, finished_name: str, next_name: str):
        await self.broadcast("questionnaire_transition", {
            "finished_questionnaire": finished_name,
            "next_questionnaire": next_name,
            "message": f"Fin de {finished_name} ! Prochain : {next_name}"
        })

    async def send_audio_play(self, files: list):
        self._audio_play_count += 1
        self._audio_token += 1
        self._audio_token_received = False
        self._current_audio_sequence = str(uuid.uuid4())
        self._audio_ended_event.clear()
        self._audio_play_start = time.monotonic()
        print(f"[WebSocket] send_audio_play token={self._audio_token}, sequence_id={self._current_audio_sequence}, files={len(files)}")
        await self.broadcast("audio_play", {
            "files": files,
            "token": self._audio_token,
            "sequence_id": self._current_audio_sequence,
        })

    async def wait_audio_ended(self, timeout: float, num_files: int = 0) -> bool:
        min_elapsed = max(0.5, num_files * 0.8) if num_files > 0 else 0.5
        if self._audio_token_received:
            elapsed = time.monotonic() - getattr(self, '_audio_play_start', 0)
            if elapsed < min_elapsed:
                await asyncio.sleep(min_elapsed - elapsed)
            return True
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None, self._audio_ended_event.wait, timeout
        )
        if result:
            elapsed = time.monotonic() - getattr(self, '_audio_play_start', 0)
            if elapsed < min_elapsed:
                await asyncio.sleep(min_elapsed - elapsed)
            print(f"[WebSocket] wait_audio_ended completed (token={self._audio_token}, elapsed={elapsed:.1f}s, min={min_elapsed:.1f}s)")
        else:
            print(f"[WebSocket] wait_audio_ended TIMEOUT (token={self._audio_token})")
        return result

    async def send_music_command(self, command: str, data: dict = None):
        payload = {"command": command, **(data or {})}
        await self.broadcast("music_command", payload)

    async def send_music_ducking(self, duck: bool):
        await self.broadcast("music_ducking", {"duck": duck})

    async def send_game_end(self, final_leaderboard: list, stats: Dict):
        players = [
            {
                "username": p.get("username", ""),
                "score": p.get("score", 0),
                "rank": p.get("rank", 0),
                "profile_picture_url": p.get("profile_picture_url", "")
            }
            for p in final_leaderboard[:10]
        ]
        await self.broadcast("game_end", {
            "leaderboard": players,
            "stats": stats,
            "message": "Fin du quiz!"
        })

    async def send_double_open(self, duration: int):
        await self.broadcast("double_open", {
            "duration": duration,
            "message": "Tape X2 pour doubler tes points !"
        })

    async def send_double_show(self, participants: list, count: int):
        await self.broadcast("double_show", {
            "participants": participants,
            "count": count
        })

    async def send_x2_registered(self, participants: list, count: int):
        await self.broadcast("x2_registered", {
            "participants": participants,
            "count": count
        })

    async def send_double_result(self, successful: list, failed: list):
        await self.broadcast("double_result", {
            "successful": successful,
            "failed": failed,
            "success_count": len(successful),
            "fail_count": len(failed)
        })

    async def stop(self):
        self._running = False

        for client in list(self.clients):
            try:
                await client.close()
            except Exception:
                pass

        self.clients.clear()

        if self.server:
            self.server.close()
            await self.server.wait_closed()
            self.server = None

        self._tl("WS stop")
        print("[WebSocket] Server stopped")

    async def reset_clients(self):
        for client in list(self.clients):
            try:
                await client.close()
            except Exception:
                pass
        self.clients.clear()
        print("[WebSocket] Clients reset (server still listening)")

    def is_serving(self) -> bool:
        return self.server is not None and self._running

    def get_client_count(self) -> int:
        return len(self.clients)
