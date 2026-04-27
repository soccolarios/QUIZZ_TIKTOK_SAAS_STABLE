#!/usr/bin/env python3
import asyncio
import argparse
import signal
import sys
import os
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from logging_config import setup_logging
setup_logging()

from game_engine import GameEngine
from models import GameConfig
import database as db
import config_loader as cfg


game_engine: GameEngine = None


def signal_handler(sig, frame):
    print("\n[Main] Signal d'arret recu...")
    if game_engine:
        asyncio.create_task(game_engine.stop())
    sys.exit(0)


def pause_handler(sig, frame):
    if game_engine:
        game_engine.pause()


def resume_handler(sig, frame):
    if game_engine:
        game_engine.resume()


def stdin_listener():
    try:
        for line in sys.stdin:
            cmd = line.strip().upper()
            if cmd == 'PAUSE' and game_engine:
                game_engine.pause()
            elif cmd == 'RESUME' and game_engine:
                game_engine.resume()
    except (EOFError, OSError):
        pass


async def main():
    global game_engine

    parser = argparse.ArgumentParser(
        description='TikTok Live Quiz Game',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Exemples:
  python run.py --tiktok El_kesolar           # Mode TikTok reel
  python run.py --simulate                    # Mode simulation (test)
  python run.py --tiktok El_kesolar --mode sequential  # Tous les questionnaires
  python run.py --tiktok El_kesolar --questionnaire 1  # Questionnaire specifique
        '''
    )
    parser.add_argument(
        '--tiktok', '-t',
        type=str,
        default=None,
        help='Username TikTok (sans @) pour le mode reel'
    )
    parser.add_argument(
        '--simulate', '-s',
        action='store_true',
        help='Mode simulation avec joueurs fictifs (pour tests uniquement)'
    )
    parser.add_argument(
        '--questions', '-q',
        type=int,
        default=0,
        help='Nombre de questions par questionnaire (0 = toutes)'
    )
    parser.add_argument(
        '--time', '-T',
        type=int,
        default=None,
        help=f'Temps par question en secondes (defaut: {cfg.get("game", "question_time", 20)})'
    )
    parser.add_argument(
        '--countdown', '-c',
        type=int,
        default=None,
        help=f'Temps entre les questions (defaut: {cfg.get("game", "countdown_time", 10)})'
    )
    parser.add_argument(
        '--no-tts',
        action='store_true',
        help='Desactiver la synthese vocale'
    )
    parser.add_argument(
        '--port', '-p',
        type=int,
        default=cfg.get('websocket', 'port', 8765),
        help=f'Port du serveur WebSocket (defaut: {cfg.get("websocket", "port", 8765)})'
    )
    parser.add_argument(
        '--reset-db',
        action='store_true',
        help='Reinitialiser la base de donnees au demarrage'
    )
    parser.add_argument(
        '--auto',
        action='store_true',
        help='Demarrer automatiquement sans attendre ENTREE'
    )
    parser.add_argument(
        '--delay', '-d',
        type=int,
        default=None,
        help=f'Delai TikTok en secondes (defaut: {cfg.get("game", "tiktok_delay", 4)})'
    )
    parser.add_argument(
        '--mode', '-m',
        type=str,
        default='single',
        choices=['single', 'sequential', 'infinite_all', 'infinite_single'],
        help='Mode de lecture (defaut: single)'
    )
    parser.add_argument(
        '--questionnaire',
        type=int,
        default=None,
        help='ID du questionnaire a jouer (mode single/infinite_single)'
    )
    parser.add_argument(
        '--questionnaires',
        type=str,
        default=None,
        help='IDs des questionnaires separes par des virgules (ex: 1,2,3)'
    )

    args = parser.parse_args()

    print()
    print("=" * 60)
    print("  TIKTOK LIVE QUIZ GAME")
    print("=" * 60)
    print()

    if not args.tiktok and not args.simulate:
        print("[ERREUR] Vous devez specifier un mode:")
        print("  --tiktok <username>  : pour le mode TikTok reel")
        print("  --simulate           : pour le mode simulation (test)")
        print()
        print("Exemple: python run.py --tiktok El_kesolar")
        print()
        sys.exit(1)

    if args.reset_db:
        print("[DB] Reinitialisation de la base de donnees...")
        db.reset_database()
        print("[DB] Base reinitialisee")
        print()

    tiktok_delay_value = 0
    if args.tiktok:
        tiktok_delay_value = args.delay if args.delay is not None else None

    questionnaire_ids = []
    if args.questionnaires:
        try:
            questionnaire_ids = [int(x.strip()) for x in args.questionnaires.split(',')]
        except ValueError:
            print("[ERREUR] Format invalide pour --questionnaires. Utilisez: 1,2,3")
            sys.exit(1)

    config = GameConfig(
        question_time=args.time,
        countdown_time=args.countdown,
        total_questions=args.questions,
        tiktok_delay=tiktok_delay_value,
        play_mode=args.mode,
        questionnaire_id=args.questionnaire,
        questionnaire_ids=questionnaire_ids
    )

    game_engine = GameEngine(
        config=config,
        tiktok_username=args.tiktok,
        simulate=args.simulate
    )

    if args.no_tts:
        game_engine.tts.enabled = False

    game_engine.ws_server.port = args.port

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    if sys.platform != 'win32':
        signal.signal(signal.SIGUSR1, pause_handler)
        signal.signal(signal.SIGUSR2, resume_handler)

    stdin_thread = threading.Thread(target=stdin_listener, daemon=True)
    stdin_thread.start()

    try:
        await game_engine.initialize()

        if not game_engine.tiktok.is_connected:
            print("[Info] TikTok se connecte en arriere-plan...")

        print()
        print("-" * 60)
        print("  CONFIGURATION")
        print("-" * 60)

        if args.simulate:
            print("  Mode          : SIMULATION (joueurs fictifs)")
        else:
            print(f"  Mode          : TIKTOK REEL")
            print(f"  Username      : @{args.tiktok}")

        questions_display = args.questions if args.questions > 0 else "TOUTES"
        print(f"  Questions     : {questions_display}")
        print(f"  Temps/Question: {config.question_time}s")
        print(f"  Countdown     : {config.countdown_time}s")
        print(f"  TTS Active    : {not args.no_tts}")
        print(f"  Port WebSocket: {args.port}")
        print(f"  Mode lecture  : {args.mode}")
        if args.questionnaire:
            print(f"  Questionnaire : #{args.questionnaire}")
        if questionnaire_ids:
            print(f"  Questionnaires: {questionnaire_ids}")
        if args.tiktok:
            print(f"  Delai TikTok  : {config.tiktok_delay}s")
        print("-" * 60)
        print()
        print("  OVERLAY URL:")
        print("  file://" + os.path.abspath(
            os.path.join(os.path.dirname(__file__), '..', 'frontend', 'overlay.html')
        ))
        print()
        print("-" * 60)
        print()

        if not args.simulate:
            print("  LOGS EN TEMPS REEL:")
            print("  [TIKTOK] Commentaire recu: NOM -> message")
            print("  [PARSER] Reponse reconnue: NOM -> A/B/C/D")
            print("  [ANSWER] Acceptee: NOM -> REPONSE (status)")
            print()
            print("-" * 60)
            print()

        if args.auto:
            print("[AUTO] Demarrage automatique...")
        else:
            input("Appuyez sur ENTREE pour demarrer la partie...")
        print()

        await game_engine.start_game()

        print()
        print("=" * 60)
        print("  PARTIE TERMINEE!")
        print("=" * 60)

        stats = game_engine.tiktok.get_stats()
        print(f"  Commentaires recus: {stats['comment_count']}")
        print()

        if not args.auto:
            input("Appuyez sur ENTREE pour quitter...")

    except KeyboardInterrupt:
        print("\n[Main] Interrompu par l'utilisateur")
    except Exception as e:
        print(f"\n[Main] Erreur: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if game_engine:
            await game_engine.stop()


if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    asyncio.run(main())
