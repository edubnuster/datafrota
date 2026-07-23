import ctypes
import ctypes.wintypes
import datetime as dt
import json
import logging
import os
import queue
import socket
import threading
import time
import tkinter as tk
import zipfile
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
from tkinter import messagebox, simpledialog, ttk
from urllib import error, parse, request

try:
    import psycopg  # type: ignore
except ImportError:
    psycopg = None

try:
    import psycopg2  # type: ignore
except ImportError:
    psycopg2 = None


WM_HOTKEY = 0x0312
WM_QUIT = 0x0012
PM_REMOVE = 0x0001
MOD_NOREPEAT = 0x4000
VK_F9 = 0x78
HOTKEY_ID = 1
HOTKEY_LABEL = "F9"
DEBUG_SESSION_ENV = ".dbg/pdv-snapshot-sync.env"
SINGLE_INSTANCE_MUTEX = "Global\\IntegracaoFrotaSingleInstance"
SHOW_WINDOW_EVENT = "Global\\IntegracaoFrotaShowWindow"
EVENT_MODIFY_STATE = 0x0002
SYNCHRONIZE = 0x00100000
WAIT_OBJECT_0 = 0x00000000
CONTEXT_REFRESH_TTL_SECONDS = 15.0
PROMOTION_SYNC_INTERVAL_MS = 5000
APP_INSTALL_DIR = Path(__file__).resolve().parent
DEFAULT_APP_DATA_DIR = Path(os.getenv("PROGRAMDATA") or r"C:\ProgramData") / "Datafrota"
APP_DATA_DIR = Path(os.getenv("FROTA_APP_DATA_DIR") or DEFAULT_APP_DATA_DIR)
PROMOTION_CACHE_FILE = APP_DATA_DIR / "pdv_promotions_cache.json"
AGENT_CREDENTIALS_FILE = APP_DATA_DIR / "pdv_agent_credentials.json"
LOCAL_DB_CONFIG_FILE = APP_DATA_DIR / "local_db_config.json"
DEFAULT_LOGO_FILE_NAME = "icone_databrev_transparent.png"
MINIMAL_WINDOW_GEOMETRY = "520x220"
FULL_WINDOW_GEOMETRY = "760x680"
MINIMAL_WINDOW_SIZE = (520, 220)
FULL_WINDOW_SIZE = (760, 680)
BRAND_LOGO_MAX_WIDTH = 52
BRAND_LOGO_MAX_HEIGHT = 72
LOG_DIR = APP_DATA_DIR / "log"
LOG_BACKUP_DIR = LOG_DIR / "backup"
LOG_FILE = LOG_DIR / "pdv-vouchers.log"
LOG_RETENTION_DAYS = 30


def ensure_app_data_dir() -> None:
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)


def resolve_brand_logo_file() -> Path | None:
    override = os.getenv("FROTA_APP_LOGO_FILE")
    candidates = []
    if override:
        candidates.append(Path(override))
    candidates.extend(
        [
            APP_INSTALL_DIR / "branding" / DEFAULT_LOGO_FILE_NAME,
            APP_INSTALL_DIR / DEFAULT_LOGO_FILE_NAME,
            APP_INSTALL_DIR.parent / "public" / "branding" / DEFAULT_LOGO_FILE_NAME,
        ]
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


class CompressedTimedRotatingFileHandler(TimedRotatingFileHandler):
    def __init__(self, filename: str, backup_dir: Path, retention_days: int = LOG_RETENTION_DAYS) -> None:
        self.backup_dir = backup_dir
        self.retention_days = retention_days
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        super().__init__(filename, when="midnight", interval=1, backupCount=0, encoding="utf-8", delay=True)
        self.suffix = "%Y-%m-%d"
        self._compress_pending_rotated_files()
        self._cleanup_old_backups()

    def rotate(self, source: str, dest: str) -> None:
        if not os.path.exists(source):
            return
        super().rotate(source, dest)
        self._compress_rotated_file(Path(dest))
        self._cleanup_old_backups()

    def _compress_pending_rotated_files(self) -> None:
        base_path = Path(self.baseFilename)
        for rotated_file in base_path.parent.glob(f"{base_path.name}.*"):
            if rotated_file.is_file() and self._extract_date_label(rotated_file.name, base_path.name):
                self._compress_rotated_file(rotated_file)

    def _compress_rotated_file(self, rotated_file: Path) -> None:
        base_name = Path(self.baseFilename).name
        date_label = self._extract_date_label(rotated_file.name, base_name)
        if not date_label:
            return

        zip_path = self.backup_dir / f"{Path(self.baseFilename).stem}-{date_label}.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(rotated_file, arcname=rotated_file.name)
        rotated_file.unlink(missing_ok=True)

    def _cleanup_old_backups(self) -> None:
        prefix = f"{Path(self.baseFilename).stem}-"
        cutoff_date = dt.date.today() - dt.timedelta(days=self.retention_days)
        for backup_file in self.backup_dir.glob("*.zip"):
            if not backup_file.is_file() or not backup_file.stem.startswith(prefix):
                continue
            date_label = backup_file.stem[len(prefix) :]
            try:
                backup_date = dt.datetime.strptime(date_label, "%Y-%m-%d").date()
            except ValueError:
                continue
            if backup_date < cutoff_date:
                backup_file.unlink(missing_ok=True)

    @staticmethod
    def _extract_date_label(file_name: str, base_name: str) -> str | None:
        prefix = f"{base_name}."
        if not file_name.startswith(prefix):
            return None
        date_label = file_name[len(prefix) :][:10]
        try:
            dt.datetime.strptime(date_label, "%Y-%m-%d")
        except ValueError:
            return None
        return date_label


def _normalize_log_value(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _normalize_log_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_normalize_log_value(item) for item in value]
    return str(value)


def setup_cashier_logger() -> logging.Logger:
    logger = logging.getLogger("datafrota.cashier")
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    logger.propagate = False
    ensure_app_data_dir()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    LOG_BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    handler = CompressedTimedRotatingFileHandler(str(LOG_FILE), backup_dir=LOG_BACKUP_DIR)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S"))
    logger.addHandler(handler)
    return logger


CASHIER_LOGGER = setup_cashier_logger()


def log_cashier_event(
    level: int,
    event: str,
    message: str,
    data: dict | None = None,
    exc_info=None,
) -> None:
    payload = {
        "event": event,
        "message": message,
        "data": _normalize_log_value(data or {}),
    }
    CASHIER_LOGGER.log(
        level,
        json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":")),
        exc_info=exc_info,
    )


# #region debug-point shared:report
def debug_report(
    hypothesis_id: str,
    location: str,
    msg: str,
    data: dict | None = None,
    run_id: str = "pre-fix",
) -> None:
    if getattr(debug_report, "_config", None) is None:
        debug_server_url = "http://127.0.0.1:7777/event"
        debug_session_id = "py-app-launch"
        try:
            with open(".dbg/py-app-launch.env", encoding="utf-8") as env_file:
                for line in env_file:
                    if line.startswith("DEBUG_SERVER_URL="):
                        debug_server_url = line.split("=", 1)[1].strip() or debug_server_url
                    elif line.startswith("DEBUG_SESSION_ID="):
                        debug_session_id = line.split("=", 1)[1].strip() or debug_session_id
        except OSError:
            pass
        debug_report._config = (debug_server_url, debug_session_id)

    debug_server_url, debug_session_id = debug_report._config
    payload = {
        "sessionId": debug_session_id,
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "msg": msg,
        "data": data or {},
    }

    def sender() -> None:
        try:
            req = request.Request(
                debug_server_url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with request.urlopen(req, timeout=0.15):
                pass
        except Exception:
            pass

    threading.Thread(target=sender, daemon=True).start()


# #endregion


# #region debug-point shared:cashier-report
def debug_report_cashier(
    hypothesis_id: str,
    location: str,
    msg: str,
    data: dict | None = None,
    run_id: str = "pre-fix",
) -> None:
    if getattr(debug_report_cashier, "_config", None) is None:
        debug_server_url = "http://127.0.0.1:7778/event"
        debug_session_id = "cashier-preauth-stuck"

        try:
            with open(DEBUG_SESSION_ENV, encoding="utf-8") as env_file:
                for line in env_file:
                    if line.startswith("DEBUG_SERVER_URL="):
                        debug_server_url = line.split("=", 1)[1].strip() or debug_server_url
                    elif line.startswith("DEBUG_SESSION_ID="):
                        debug_session_id = line.split("=", 1)[1].strip() or debug_session_id
        except OSError:
            pass
        debug_report_cashier._config = (debug_server_url, debug_session_id)

    debug_server_url, debug_session_id = debug_report_cashier._config
    payload = {
        "sessionId": debug_session_id,
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "msg": msg,
        "data": data or {},
    }

    def sender() -> None:
        try:
            req = request.Request(
                debug_server_url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with request.urlopen(req, timeout=0.15):
                pass
        except Exception:
            pass

    threading.Thread(target=sender, daemon=True).start()


# #endregion


def acquire_single_instance_mutex() -> int | None:
    kernel32 = ctypes.windll.kernel32
    mutex_handle = kernel32.CreateMutexW(None, False, SINGLE_INSTANCE_MUTEX)
    if not mutex_handle:
        return None
    if kernel32.GetLastError() == 183:
        kernel32.CloseHandle(mutex_handle)
        return None
    return int(mutex_handle)


def release_single_instance_mutex(mutex_handle: int | None) -> None:
    if mutex_handle:
        ctypes.windll.kernel32.CloseHandle(ctypes.c_void_p(mutex_handle))


def create_show_event() -> int | None:
    kernel32 = ctypes.windll.kernel32
    event_handle = kernel32.CreateEventW(None, False, False, SHOW_WINDOW_EVENT)
    if not event_handle:
        return None
    return int(event_handle)


def signal_existing_instance() -> bool:
    kernel32 = ctypes.windll.kernel32
    event_handle = kernel32.OpenEventW(EVENT_MODIFY_STATE, False, SHOW_WINDOW_EVENT)
    if not event_handle:
        return False
    try:
        return bool(kernel32.SetEvent(event_handle))
    finally:
        kernel32.CloseHandle(event_handle)


def release_handle(handle: int | None) -> None:
    if handle:
        ctypes.windll.kernel32.CloseHandle(ctypes.c_void_p(handle))


def load_promotion_cache() -> dict:
    try:
        with open(PROMOTION_CACHE_FILE, encoding="utf-8") as cache_file:
            payload = json.load(cache_file)
    except (OSError, json.JSONDecodeError):
        return {"items": [], "serverTime": None, "promotionCursor": None}

    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    return {
        "items": [item for item in items if isinstance(item, dict)],
        "serverTime": payload.get("serverTime") if isinstance(payload.get("serverTime"), str) else None,
        "promotionCursor": payload.get("promotionCursor") if isinstance(payload.get("promotionCursor"), int) else None,
    }


def save_promotion_cache(items: list[dict], server_time: str | None, promotion_cursor: int | None) -> None:
    payload = {
        "serverTime": server_time,
        "promotionCursor": promotion_cursor,
        "savedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "items": items,
    }
    try:
        ensure_app_data_dir()
        with open(PROMOTION_CACHE_FILE, "w", encoding="utf-8") as cache_file:
            json.dump(payload, cache_file, ensure_ascii=True, indent=2)
    except OSError:
        pass


def load_agent_credentials() -> dict:
    try:
        with open(AGENT_CREDENTIALS_FILE, encoding="utf-8") as credentials_file:
            payload = json.load(credentials_file)
    except (OSError, json.JSONDecodeError):
        return {}

    if not isinstance(payload, dict):
        return {}

    agent = payload.get("agent") if isinstance(payload.get("agent"), dict) else {}
    return {
        "apiToken": payload.get("apiToken") if isinstance(payload.get("apiToken"), str) else None,
        "agent": agent,
    }


def save_agent_credentials(payload: dict) -> None:
    try:
        ensure_app_data_dir()
        with open(AGENT_CREDENTIALS_FILE, "w", encoding="utf-8") as credentials_file:
            json.dump(payload, credentials_file, ensure_ascii=True, indent=2)
    except OSError:
        pass


def clear_agent_credentials() -> None:
    try:
        os.remove(AGENT_CREDENTIALS_FILE)
    except OSError:
        pass


def load_local_db_config() -> dict:
    try:
        with open(LOCAL_DB_CONFIG_FILE, encoding="utf-8") as config_file:
            payload = json.load(config_file)
    except (OSError, json.JSONDecodeError):
        return {}

    if not isinstance(payload, dict):
        return {}

    return {
        "host": str(payload.get("host") or "").strip(),
        "port": str(payload.get("port") or "5432").strip() or "5432",
        "user": str(payload.get("user") or "").strip(),
        "password": str(payload.get("password") or ""),
        "database": str(payload.get("database") or "").strip(),
    }


def save_local_db_config(payload: dict) -> None:
    ensure_app_data_dir()
    with open(LOCAL_DB_CONFIG_FILE, "w", encoding="utf-8") as config_file:
        json.dump(payload, config_file, ensure_ascii=True, indent=2)


def format_local_db_summary(payload: dict | None = None) -> str:
    config = payload or load_local_db_config()
    host = str(config.get("host") or "").strip()
    port = str(config.get("port") or "").strip()
    database = str(config.get("database") or "").strip()
    user = str(config.get("user") or "").strip()

    if not host or not port or not database:
        return "Banco local ainda nao configurado neste terminal."

    summary = f"{host}:{port} / {database}"
    if user:
        summary += f" (usuario {user})"
    return summary


def get_local_db_health_state(payload: dict | None = None) -> tuple[str, str]:
    config = payload or load_local_db_config()
    required_keys = ["host", "port", "user", "database"]
    if not all(str(config.get(key) or "").strip() for key in required_keys):
        return "pending", "Conexao local pendente"

    ok, _message = test_local_db_config(config)
    if ok:
        return "ok", "Conexao local OK"

    return "error", "Conexao local com falha"


def has_postgres_driver() -> bool:
    return psycopg is not None or psycopg2 is not None


def test_local_db_config(payload: dict) -> tuple[bool, str]:
    host = str(payload.get("host") or "").strip()
    port_text = str(payload.get("port") or "").strip() or "5432"
    user = str(payload.get("user") or "").strip()
    database = str(payload.get("database") or "").strip()

    if not host or not user or not database:
        return False, "Preencha host, usuario e nome do banco para testar a conexao."

    try:
        port = int(port_text)
    except ValueError:
        return False, "Informe uma porta valida para o PostgreSQL."

    if psycopg is not None:
        try:
            with psycopg.connect(  # type: ignore[union-attr]
                host=host,
                port=port,
                user=user,
                password=str(payload.get("password") or ""),
                dbname=database,
                connect_timeout=5,
            ) as connection:
                with connection.cursor() as cursor:
                    cursor.execute("select 1")
                    cursor.fetchone()
            return True, "Conexao validada com sucesso no PostgreSQL local."
        except Exception as exc:  # noqa: BLE001
            return False, f"Falha ao validar a conexao: {exc}"

    if psycopg2 is not None:
        try:
            connection = psycopg2.connect(  # type: ignore[union-attr]
                host=host,
                port=port,
                user=user,
                password=str(payload.get("password") or ""),
                dbname=database,
                connect_timeout=5,
            )
            cursor = connection.cursor()
            cursor.execute("select 1")
            cursor.fetchone()
            cursor.close()
            connection.close()
            return True, "Conexao validada com sucesso no PostgreSQL local."
        except Exception as exc:  # noqa: BLE001
            return False, f"Falha ao validar a conexao: {exc}"

    try:
        with socket.create_connection((host, port), timeout=5):
            return True, "Porta do PostgreSQL acessivel. Instale psycopg/psycopg2 para validar credenciais diretamente no app."
    except OSError as exc:
        return False, f"Falha ao alcançar o host/porta informados: {exc}"


class LocalDbConfigDialog:
    def __init__(self, parent: tk.Tk) -> None:
        # #region debug-point B:dialog-init
        debug_report(
            "B",
            "integracao_frota_app.py:LocalDbConfigDialog.__init__",
            "[DEBUG] Inicializando dialogo de configuracao do banco local",
            {"parent_state": str(parent.state())},
        )
        # #endregion
        self.parent = parent
        self.result: dict | None = None
        self._accepted = False
        initial = load_local_db_config()

        self.window = tk.Toplevel(parent)
        self.window.title("configuração do banco local")
        self.window.geometry("520x420")
        self.window.resizable(False, False)
        if str(parent.state()) != "withdrawn":
            self.window.transient(parent)
        self.window.grab_set()
        self.window.protocol("WM_DELETE_WINDOW", self._on_cancel)
        self.window.attributes("-topmost", True)

        container = ttk.Frame(self.window, padding=18)
        container.pack(fill="both", expand=True)

        ttk.Label(container, text="configuração inicial do banco local", font=("Segoe UI", 15, "bold")).pack(anchor="w")
        ttk.Label(
            container,
            text=(
                "No primeiro uso, informe a conexão com o PostgreSQL local do cliente. "
                "Esses dados ficam salvos neste terminal para futuras validações."
            ),
            wraplength=470,
        ).pack(anchor="w", pady=(6, 14))

        form = ttk.Frame(container)
        form.pack(fill="x")
        form.columnconfigure(1, weight=1)

        self.host_var = tk.StringVar(value=initial.get("host") or os.getenv("PGHOST") or "localhost")
        self.port_var = tk.StringVar(value=initial.get("port") or os.getenv("PGPORT") or "5432")
        self.user_var = tk.StringVar(value=initial.get("user") or os.getenv("PGUSER") or "postgres")
        self.password_var = tk.StringVar(value=initial.get("password") or os.getenv("PGPASSWORD") or "")
        self.database_var = tk.StringVar(value=initial.get("database") or os.getenv("PGDATABASE") or "frota")
        self.status_var = tk.StringVar(
            value=(
                "Use 'Testar conexao' antes de continuar."
                if has_postgres_driver()
                else "Driver PostgreSQL nao encontrado no Python. O app ainda pode salvar os dados e testar host/porta."
            )
        )

        self._add_field(form, 0, "Host", self.host_var)
        self._add_field(form, 1, "Porta", self.port_var)
        self._add_field(form, 2, "Usuario", self.user_var)
        self._add_field(form, 3, "Senha", self.password_var, show="*")
        self._add_field(form, 4, "Banco", self.database_var)

        ttk.Label(container, textvariable=self.status_var, wraplength=470, foreground="#475569").pack(
            anchor="w", pady=(14, 0)
        )

        actions = ttk.Frame(container)
        actions.pack(fill="x", pady=(18, 0))

        ttk.Button(actions, text="Cancelar", command=self._on_cancel).pack(side="left")
        ttk.Button(actions, text="Testar conexao", command=self._on_test).pack(side="right")
        ttk.Button(actions, text="Salvar e continuar", command=self._on_submit).pack(side="right", padx=(0, 8))

        self.window.bind("<Return>", lambda _event: self._on_submit())
        self.window.bind("<Escape>", lambda _event: self._on_cancel())
        self.window.wait_visibility()
        center_window(self.window, parent)
        self.window.deiconify()
        self.window.lift()
        self.window.focus_force()

    def _add_field(self, parent: ttk.Frame, row: int, label: str, variable: tk.StringVar, show: str | None = None) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=(0, 10), pady=(0, 10))
        entry = ttk.Entry(parent, textvariable=variable, show=show or "")
        entry.grid(row=row, column=1, sticky="ew", pady=(0, 10))

    def _build_payload(self) -> dict:
        return {
            "host": self.host_var.get().strip(),
            "port": self.port_var.get().strip() or "5432",
            "user": self.user_var.get().strip(),
            "password": self.password_var.get(),
            "database": self.database_var.get().strip(),
        }

    def _on_test(self) -> None:
        ok, message = test_local_db_config(self._build_payload())
        self.status_var.set(message)
        if ok:
            messagebox.showinfo("configuração do banco", message, parent=self.window)
        else:
            messagebox.showerror("configuração do banco", message, parent=self.window)

    def _on_submit(self) -> None:
        payload = self._build_payload()
        # #region debug-point C:dialog-submit
        debug_report(
            "C",
            "integracao_frota_app.py:LocalDbConfigDialog._on_submit",
            "[DEBUG] Usuario tentou salvar configuracao do banco local",
            {
                "host": payload.get("host"),
                "port": payload.get("port"),
                "user": payload.get("user"),
                "database": payload.get("database"),
            },
        )
        # #endregion
        missing = [key for key in ["host", "port", "user", "database"] if not str(payload.get(key) or "").strip()]
        if missing:
            messagebox.showerror(
                "configuração do banco",
                "Preencha host, porta, usuario e nome do banco antes de continuar.",
                parent=self.window,
            )
            return

        ok, message = test_local_db_config(payload)
        self.status_var.set(message)
        if not ok:
            proceed = messagebox.askyesno(
                "configuração do banco",
                f"{message}\n\nDeseja salvar mesmo assim e continuar?",
                parent=self.window,
            )
            if not proceed:
                return

        save_local_db_config(payload)
        self.result = payload
        self._accepted = True
        self.window.destroy()

    def _on_cancel(self) -> None:
        # #region debug-point B:dialog-cancel
        debug_report(
            "B",
            "integracao_frota_app.py:LocalDbConfigDialog._on_cancel",
            "[DEBUG] Dialogo de configuracao do banco local foi cancelado",
            {},
        )
        # #endregion
        self._accepted = False
        self.window.destroy()

    def show(self) -> dict | None:
        # #region debug-point B:dialog-show
        debug_report(
            "B",
            "integracao_frota_app.py:LocalDbConfigDialog.show",
            "[DEBUG] Aguardando fechamento do dialogo de configuracao do banco local",
            {},
        )
        # #endregion
        self.parent.wait_window(self.window)
        # #region debug-point B:dialog-result
        debug_report(
            "B",
            "integracao_frota_app.py:LocalDbConfigDialog.show",
            "[DEBUG] Dialogo de configuracao do banco local foi encerrado",
            {"accepted": self._accepted},
        )
        # #endregion
        return self.result if self._accepted else None


def ensure_local_db_configuration(root: tk.Tk) -> bool:
    config = load_local_db_config()
    required_keys = ["host", "port", "user", "database"]
    # #region debug-point A:ensure-config
    debug_report(
        "A",
        "integracao_frota_app.py:ensure_local_db_configuration",
        "[DEBUG] Verificando configuracao local obrigatoria antes de iniciar o app",
        {
            "has_host": bool(str(config.get("host") or "").strip()),
            "has_port": bool(str(config.get("port") or "").strip()),
            "has_user": bool(str(config.get("user") or "").strip()),
            "has_database": bool(str(config.get("database") or "").strip()),
        },
    )
    # #endregion
    if all(str(config.get(key) or "").strip() for key in required_keys):
        return True

    dialog = LocalDbConfigDialog(root)
    return dialog.show() is not None


def center_window(window: tk.Misc, parent: tk.Misc | None = None) -> None:
    try:
        window.update_idletasks()
        width = window.winfo_width() or window.winfo_reqwidth()
        height = window.winfo_height() or window.winfo_reqheight()

        if parent is not None and parent.winfo_exists() and str(parent.state()) != "withdrawn":
            parent.update_idletasks()
            parent_x = parent.winfo_rootx()
            parent_y = parent.winfo_rooty()
            parent_width = parent.winfo_width()
            parent_height = parent.winfo_height()
            x = parent_x + max((parent_width - width) // 2, 0)
            y = parent_y + max((parent_height - height) // 2, 0)
        else:
            screen_width = window.winfo_screenwidth()
            screen_height = window.winfo_screenheight()
            x = max((screen_width - width) // 2, 0)
            y = max((screen_height - height) // 2, 0)

        window.geometry(f"{width}x{height}+{x}+{y}")
    except tk.TclError:
        return


class FrotaApiClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.station_hint = (
            os.getenv("FROTA_STATION_HINT")
            or os.getenv("COMPUTERNAME")
            or os.getenv("HOSTNAME")
            or ""
        ).strip()
        self.device_name = self.station_hint or os.getenv("COMPUTERNAME") or "PDV"
        self.installed_version = os.getenv("FROTA_APP_VERSION", "1.0.0")
        self.device_fingerprint = "|".join(
            value.strip()
            for value in [
                os.getenv("COMPUTERNAME", ""),
                os.getenv("USERNAME", ""),
                os.getenv("PROCESSOR_IDENTIFIER", ""),
            ]
            if value.strip()
        )
        self.agent_credentials = load_agent_credentials()

    def validate_voucher(self, short_code: str) -> dict:
        encoded_code = parse.quote(short_code.strip().upper())
        return self._request("GET", f"{self.base_url}/cashier-discounts/{encoded_code}")

    def authorize_voucher(self, payload: dict) -> dict:
        return self._request(
            "POST",
            f"{self.base_url}/cashier-discounts/authorize",
            payload,
        )

    def get_status(self, short_code: str) -> dict:
        encoded_code = parse.quote(short_code.strip().upper())
        return self._request("GET", f"{self.base_url}/cashier-discounts/{encoded_code}/status")

    def get_context(self) -> dict:
        query = ""
        if self.station_hint:
            query = "?" + parse.urlencode({"stationHint": self.station_hint})
        return self._request("GET", f"{self.base_url}/cashier-discounts/context{query}")

    def bootstrap(self) -> dict:
        return self._request("POST", f"{self.base_url}/cashier-discounts/bootstrap", {})

    def sync_promotions(self, cursor: int | None = None) -> dict:
        query = ""
        if isinstance(cursor, int) and cursor > 0:
            query = "?" + parse.urlencode({"cursor": str(cursor)})
        # #region debug-point A:api-sync-promotions
        debug_report_cashier(
            "A",
            "integracao_frota_app.py:787",
            "[DEBUG] API PDV sync_promotions chamado",
            {
                "baseUrl": self.base_url,
                "hasCursor": isinstance(cursor, int) and cursor > 0,
                "cursor": cursor,
                "hasAgentCredentials": self.has_agent_credentials(),
            },
        )
        # #endregion
        return self._request("GET", f"{self.base_url}/pdv-agents/me/sync{query}")

    def has_agent_credentials(self) -> bool:
        return bool(self.agent_credentials.get("apiToken"))

    def clear_agent_credentials(self) -> None:
        self.agent_credentials = {}
        clear_agent_credentials()

    def activate_agent(self, pairing_code: str) -> dict:
        response = self._request(
            "POST",
            f"{self.base_url}/pdv-agents/activate",
            {
                "pairingCode": pairing_code.strip().upper(),
                "stationCode": self.station_hint or None,
                "deviceName": self.device_name or None,
                "deviceFingerprint": self.device_fingerprint or None,
                "installedVersion": self.installed_version or None,
            },
            include_auth=False,
        )
        if not response.get("success"):
            raise RuntimeError(response.get("error") or "Nao foi possivel ativar este PDV.")

        item = response.get("item", {}) if isinstance(response.get("item"), dict) else {}
        api_token = item.get("apiToken") if isinstance(item.get("apiToken"), str) else ""
        agent = item.get("agent") if isinstance(item.get("agent"), dict) else {}
        if not api_token or not agent:
            raise RuntimeError("A ativacao do PDV retornou um payload incompleto.")

        self.agent_credentials = {
            "apiToken": api_token,
            "agent": agent,
        }
        save_agent_credentials(self.agent_credentials)
        return item

    def _build_headers(self, include_auth: bool = True) -> dict:
        headers = {"Accept": "application/json"}
        if include_auth:
            api_token = self.agent_credentials.get("apiToken")
            if isinstance(api_token, str) and api_token.strip():
                headers["Authorization"] = f"Bearer {api_token.strip()}"
        return headers

    def _request(self, method: str, url: str, payload: dict | None = None, include_auth: bool = True) -> dict:
        data = None
        headers = self._build_headers(include_auth=include_auth)

        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = request.Request(url=url, method=method, data=data, headers=headers)

        try:
            log_cashier_event(
                logging.INFO,
                "api_request_started",
                "Requisicao HTTP do PDV iniciada.",
                {
                    "method": method,
                    "url": url,
                    "payload": payload or {},
                    "authenticated": include_auth,
                },
            )
            # #region debug-point A:python-http-start
            debug_report_cashier(
                "A",
                "integracao_frota_app.py:FrotaApiClient._request",
                "[DEBUG] Inicio da requisicao HTTP do integrador",
                {"method": method, "url": url, "payload": payload or {}},
            )
            # #endregion
            with request.urlopen(req, timeout=8) as response:
                body = json.loads(response.read().decode("utf-8"))
                log_cashier_event(
                    logging.INFO,
                    "api_request_finished",
                    "Requisicao HTTP do PDV concluida com sucesso.",
                    {
                        "method": method,
                        "url": url,
                        "status": getattr(response, "status", None),
                        "body": body,
                    },
                )
                # #region debug-point A:python-http-success
                debug_report_cashier(
                    "A",
                    "integracao_frota_app.py:FrotaApiClient._request",
                    "[DEBUG] Requisicao HTTP concluida no integrador",
                    {"method": method, "url": url, "status": getattr(response, "status", None), "body": body},
                )
                # #endregion
                return body
        except error.HTTPError as exc:
            response_data = exc.read().decode("utf-8", errors="replace")
            try:
                body = json.loads(response_data)
            except json.JSONDecodeError:
                body = {"error": response_data or f"Erro HTTP {exc.code}"}
            log_cashier_event(
                logging.WARNING,
                "api_request_http_error",
                "Requisicao HTTP do PDV retornou erro.",
                {
                    "method": method,
                    "url": url,
                    "status": exc.code,
                    "body": body,
                },
            )
            if include_auth and exc.code == 401:
                self.clear_agent_credentials()
                raise RuntimeError(
                    body.get("error") or "A credencial deste PDV expirou ou foi revogada. Ative o terminal novamente."
                ) from exc
            # #region debug-point A:python-http-http-error
            debug_report_cashier(
                "A",
                "integracao_frota_app.py:FrotaApiClient._request",
                "[DEBUG] Requisicao HTTP retornou erro no integrador",
                {"method": method, "url": url, "status": exc.code, "body": body},
            )
            # #endregion
            raise RuntimeError(body.get("error") or f"Erro HTTP {exc.code}") from exc
        except error.URLError as exc:
            log_cashier_event(
                logging.ERROR,
                "api_request_connection_error",
                "Falha de conexao do PDV com a API.",
                {
                    "method": method,
                    "url": url,
                    "reason": str(exc.reason),
                },
                exc_info=exc,
            )
            # #region debug-point A:python-http-url-error
            debug_report_cashier(
                "A",
                "integracao_frota_app.py:FrotaApiClient._request",
                "[DEBUG] Falha de conexao na requisicao HTTP do integrador",
                {"method": method, "url": url, "reason": str(exc.reason)},
            )
            # #endregion
            raise RuntimeError("Nao foi possivel conectar na API do DataFrota.") from exc

class IntegracaoFrotaApp:
    def __init__(self, root: tk.Tk, show_event_handle: int | None = None) -> None:
        self.root = root
        self.show_event_handle = show_event_handle
        self.api = FrotaApiClient(os.getenv("FROTA_API_URL", "http://127.0.0.1:3001/api"))
        self.cashier_context: dict[str, str | int | None] = {
            "conta": None,
            "estacao": None,
            "data": None,
            "turno": None,
            "usuario": None,
            "stationSource": None,
        }
        self.validated_voucher: dict | None = None
        self.authorization_created = False
        self.is_busy = False
        self.agent_ready = self.api.has_agent_credentials()
        self.agent_pairing_in_flight = False
        self.integration_ready = False
        self.bootstrap_in_flight = False
        self.hotkey_registered = False
        self.hotkey_fallback_pressed = False
        self.hotkey_last_physical_state = False
        self.last_show_at = 0.0
        self.hotkey_listener_thread = None
        self.hotkey_listener_thread_id = 0
        self.last_context_refresh_at = 0.0
        self.context_refresh_in_flight = False
        self.status_poll_job = None
        self.promotion_sync_job = None
        self.promotion_sync_in_flight = False
        self.synced_promotions: list[dict] = []
        self.last_promotion_sync_at: str | None = None
        self.promotion_cursor: int | None = None
        self.ui_dispatch_queue = queue.SimpleQueue()
        self.ui_dispatch_job = None
        self.current_operation = "idle"
        self.last_voucher_status: str | None = None
        self.full_mode = False
        self.brand_logo_image: tk.PhotoImage | None = None

        self.root.title("Datafrota")
        self.root.geometry(MINIMAL_WINDOW_GEOMETRY)
        self.root.minsize(*MINIMAL_WINDOW_SIZE)
        self.root.resizable(False, False)
        self.root.configure(bg="#ecf1f6")
        self.root.protocol("WM_DELETE_WINDOW", self.hide_window)
        self.root.withdraw()

        self.voucher_var = tk.StringVar()
        self.conta_var = tk.StringVar(value="Sera definida no cupom")
        self.estacao_var = tk.StringVar(value="Identificando...")
        self.status_var = tk.StringVar(value="Informe o codigo do voucher.")
        self.summary_var = tk.StringVar(value="Aguardando validacao do voucher.")
        self.rule_var = tk.StringVar(value="")
        self.validity_var = tk.StringVar(value="")
        self.voucher_details_var = tk.StringVar(value="Os dados do voucher serao exibidos aqui apos a validacao do codigo.")
        self.local_db_var = tk.StringVar(value=format_local_db_summary())
        self.local_db_health_var = tk.StringVar(value="Verificando conexao local...")
        self.promotion_sync_var = tk.StringVar(value="Promocoes do PDV ainda nao sincronizadas.")
        self.validation_feedback_var = tk.StringVar(value="")

        self._load_cached_promotions()

        self._build_styles()
        self._load_brand_logo()
        self._build_layout()
        self.root.update_idletasks()
        center_window(self.root)
        self.ui_dispatch_job = self.root.after(50, self._process_ui_dispatch_queue)
        self.voucher_var.trace_add("write", self._on_voucher_change)
        self._clear_form()
        self._update_interaction_state()
        self._bind_shortcuts()
        self._register_hotkey()
        self._start_hotkey_listener()
        self._poll_hotkey_fallback()
        self._poll_show_event()
        self.root.after(10, self._complete_hidden_startup)

    def _build_styles(self) -> None:
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Main.TFrame", background="#ecf1f6")
        style.configure("Card.TFrame", background="#ffffff", relief="flat")
        style.configure("Section.TFrame", background="#f8fafc", relief="flat")
        style.configure("Visual.TFrame", background="#d8d2ba")
        style.configure("Body.TLabel", background="#ffffff", foreground="#1f2937", font=("Segoe UI", 10))
        style.configure(
            "Title.TLabel",
            background="#ffffff",
            foreground="#1f2937",
            font=("Segoe UI", 17, "bold"),
        )
        style.configure(
            "Hint.TLabel",
            background="#ffffff",
            foreground="#64748b",
            font=("Segoe UI", 9),
        )
        style.configure(
            "SectionTitle.TLabel",
            background="#ffffff",
            foreground="#0f172a",
            font=("Segoe UI", 10, "bold"),
        )
        style.configure("Visual.TLabel", background="#d8d2ba", foreground="#1f2937", font=("Segoe UI", 11, "bold"))
        style.configure("Primary.TButton", font=("Segoe UI", 10, "bold"))
        style.configure("Secondary.TButton", font=("Segoe UI", 10))

    def _load_brand_logo(self) -> None:
        logo_file = resolve_brand_logo_file()
        if logo_file is None:
            self.brand_logo_image = None
            return

        try:
            logo_image = tk.PhotoImage(file=str(logo_file))
        except tk.TclError:
            self.brand_logo_image = None
            return

        width_factor = max(1, (logo_image.width() + BRAND_LOGO_MAX_WIDTH - 1) // BRAND_LOGO_MAX_WIDTH)
        height_factor = max(1, (logo_image.height() + BRAND_LOGO_MAX_HEIGHT - 1) // BRAND_LOGO_MAX_HEIGHT)
        sample_factor = max(width_factor, height_factor)
        if sample_factor > 1:
            logo_image = logo_image.subsample(sample_factor, sample_factor)
        self.brand_logo_image = logo_image

    def _build_layout(self) -> None:
        outer = ttk.Frame(self.root, style="Main.TFrame", padding=6)
        outer.pack(fill="both", expand=True)

        card = ttk.Frame(outer, style="Card.TFrame", padding=8)
        card.pack(fill="both", expand=True)

        self.hero = tk.Frame(
            card,
            bg="#f8fafc",
            bd=0,
            highlightthickness=1,
            highlightbackground="#dbe3ee",
            padx=8,
            pady=6,
        )
        self.hero.pack(fill="x")
        self.hero.grid_columnconfigure(1, weight=1)
        self.hero.grid_columnconfigure(2, minsize=72)

        brand_shell = tk.Frame(
            self.hero,
            bg="#eef4ff",
            bd=0,
            highlightthickness=1,
            highlightbackground="#d7e4ff",
            padx=3,
            pady=3,
        )
        brand_shell.grid(row=0, column=0, rowspan=2, sticky="nw", padx=(0, 12))

        if self.brand_logo_image:
            tk.Label(brand_shell, image=self.brand_logo_image, bg="#eef4ff", bd=0).pack()
        else:
            tk.Label(
                brand_shell,
                text="DB",
                bg="#eef4ff",
                fg="#1d4ed8",
                font=("Segoe UI", 14, "bold"),
            ).pack(expand=True)

        header_frame = tk.Frame(self.hero, bg="#f8fafc")
        header_frame.grid(row=0, column=1, sticky="new", padx=(0, 10))

        tk.Label(
            header_frame,
            text="Validacao de voucher",
            bg="#f8fafc",
            fg="#0f172a",
            font=("Segoe UI", 15, "bold"),
            anchor="w",
        ).pack(anchor="w")
        tk.Label(
            header_frame,
            text="Digite o codigo do voucher e clique em ok para confirmar",
            bg="#f8fafc",
            fg="#64748b",
            font=("Segoe UI", 9),
            anchor="w",
            justify="left",
            wraplength=250,
        ).pack(anchor="w", pady=(2, 0))

        tk.Label(
            self.hero,
            text="F9 atalho",
            bg="#dbeafe",
            fg="#1d4ed8",
            font=("Segoe UI", 8, "bold"),
            padx=8,
            pady=3,
        ).grid(row=0, column=2, sticky="ne")

        input_frame = tk.Frame(self.hero, bg="#f8fafc")
        input_frame.grid(row=1, column=1, columnspan=2, sticky="ew", pady=(6, 0))

        tk.Label(
            input_frame,
            text="CODIGO DO VOUCHER",
            bg="#f8fafc",
            fg="#64748b",
            font=("Segoe UI", 8, "bold"),
            anchor="w",
        ).pack(anchor="w")

        entry_row = tk.Frame(input_frame, bg="#f8fafc")
        entry_row.pack(fill="x", pady=(3, 0))

        self.voucher_entry = ttk.Entry(entry_row, textvariable=self.voucher_var, font=("Segoe UI", 14), width=12)
        self.voucher_entry.pack(side="left", ipady=5)

        self.validation_feedback_label = tk.Label(
            input_frame,
            textvariable=self.validation_feedback_var,
            bg="#f8fafc",
            fg="#6b7280",
            font=("Segoe UI", 9, "bold"),
            anchor="w",
            justify="left",
        )
        self.validation_feedback_label.pack(fill="x", pady=(4, 0))

        self.compact_actions = ttk.Frame(entry_row, style="Card.TFrame")
        self.compact_actions.pack(side="right")

        self.compact_cancel_button = ttk.Button(
            self.compact_actions,
            text="Cancelar",
            style="Secondary.TButton",
            command=self.on_cancel,
        )
        self.compact_cancel_button.pack(side="right")

        self.compact_confirm_button = ttk.Button(
            self.compact_actions,
            text="OK",
            style="Primary.TButton",
            command=self.on_confirm,
        )
        self.compact_confirm_button.pack(side="right", padx=(0, 8))

        self.status_strip = tk.Frame(card, bg="#ffffff")
        self.status_strip.pack(fill="x", pady=(4, 6), after=self.hero)
        self.status_strip.grid_columnconfigure(0, weight=1)
        self.status_strip.grid_columnconfigure(2, weight=1)

        self.status_left_line = tk.Frame(self.status_strip, bg="#dbe3ee", height=1)
        self.status_left_line.grid(row=0, column=0, sticky="ew", padx=(0, 6), pady=(1, 0))

        self.status_label = tk.Label(
            self.status_strip,
            textvariable=self.status_var,
            bg="#ffffff",
            fg="#475569",
            font=("Segoe UI", 9),
            anchor="center",
            justify="left",
        )
        self.status_label.grid(row=0, column=1, padx=4, pady=(0, 2))

        self.status_right_line = tk.Frame(self.status_strip, bg="#dbe3ee", height=1)
        self.status_right_line.grid(row=0, column=2, sticky="ew", padx=(6, 0), pady=(1, 0))

        self.compact_overview = tk.Frame(
            card,
            bg="#ffffff",
            bd=0,
            highlightthickness=1,
            highlightbackground="#e5e7eb",
            padx=12,
            pady=8,
        )
        self.compact_overview.pack(fill="x", pady=(8, 0), after=self.hero)
        compact_header = tk.Frame(self.compact_overview, bg="#ffffff")
        compact_header.pack(fill="x")

        conta_meta = tk.Frame(compact_header, bg="#ffffff")
        conta_meta.pack(side="left", fill="x", expand=True)
        tk.Label(conta_meta, text="CONTA", bg="#ffffff", fg="#64748b", font=("Segoe UI", 8, "bold")).pack(anchor="w")
        tk.Label(
            conta_meta,
            textvariable=self.conta_var,
            bg="#ffffff",
            fg="#0f172a",
            font=("Segoe UI", 9, "bold"),
            justify="left",
            wraplength=135,
        ).pack(anchor="w", pady=(2, 0))

        estacao_meta = tk.Frame(compact_header, bg="#ffffff")
        estacao_meta.pack(side="left", fill="x", expand=True, padx=(10, 0))
        tk.Label(estacao_meta, text="ESTACAO", bg="#ffffff", fg="#64748b", font=("Segoe UI", 8, "bold")).pack(anchor="w")
        tk.Label(
            estacao_meta,
            textvariable=self.estacao_var,
            bg="#ffffff",
            fg="#0f172a",
            font=("Segoe UI", 9, "bold"),
            justify="left",
            wraplength=120,
        ).pack(anchor="w", pady=(2, 0))

        banco_meta = tk.Frame(compact_header, bg="#ffffff")
        banco_meta.pack(side="right", anchor="ne")
        tk.Label(banco_meta, text="BANCO", bg="#ffffff", fg="#64748b", font=("Segoe UI", 8, "bold")).pack(anchor="e")
        self.local_db_health_label = tk.Label(
            banco_meta,
            textvariable=self.local_db_health_var,
            bg="#ffffff",
            fg="#475569",
            font=("Segoe UI", 9, "bold"),
            justify="right",
            wraplength=135,
            anchor="e",
        )
        self.local_db_health_label.pack(anchor="e", pady=(2, 0))

        tk.Frame(self.compact_overview, bg="#e5e7eb", height=1).pack(fill="x", pady=(8, 7))
        tk.Label(
            self.compact_overview,
            textvariable=self.summary_var,
            bg="#ffffff",
            fg="#1f2937",
            font=("Segoe UI", 9),
            justify="left",
            wraplength=440,
            anchor="w",
        ).pack(fill="x")

        self.details = tk.Frame(
            card,
            bg="#f8fafc",
            bd=0,
            highlightthickness=1,
            highlightbackground="#dbe3ee",
            padx=12,
            pady=9,
        )
        tk.Label(
            self.details,
            text="Detalhes da validacao",
            bg="#f8fafc",
            fg="#0f172a",
            font=("Segoe UI", 10, "bold"),
            anchor="w",
        ).pack(anchor="w")

        details_meta = tk.Frame(self.details, bg="#f8fafc")
        details_meta.pack(fill="x", pady=(6, 0))
        for column in range(2):
            details_meta.grid_columnconfigure(column, weight=1)

        rule_card = tk.Frame(
            details_meta,
            bg="#ffffff",
            bd=0,
            highlightthickness=1,
            highlightbackground="#e5e7eb",
            padx=10,
            pady=8,
        )
        rule_card.grid(row=0, column=0, sticky="nsew", padx=(0, 6), pady=(0, 6))
        tk.Label(rule_card, text="REGRA", bg="#ffffff", fg="#64748b", font=("Segoe UI", 8, "bold")).pack(anchor="w")
        tk.Label(
            rule_card,
            textvariable=self.rule_var,
            bg="#ffffff",
            fg="#0f172a",
            font=("Segoe UI", 9),
            justify="left",
            wraplength=300,
        ).pack(anchor="w", pady=(4, 0))

        validity_card = tk.Frame(
            details_meta,
            bg="#ffffff",
            bd=0,
            highlightthickness=1,
            highlightbackground="#e5e7eb",
            padx=10,
            pady=8,
        )
        validity_card.grid(row=0, column=1, sticky="nsew", padx=(6, 0), pady=(0, 6))
        tk.Label(validity_card, text="VALIDADE", bg="#ffffff", fg="#64748b", font=("Segoe UI", 8, "bold")).pack(anchor="w")
        tk.Label(
            validity_card,
            textvariable=self.validity_var,
            bg="#ffffff",
            fg="#0f172a",
            font=("Segoe UI", 9),
            justify="left",
            wraplength=300,
        ).pack(anchor="w", pady=(4, 0))

        promotion_card = tk.Frame(
            details_meta,
            bg="#ffffff",
            bd=0,
            highlightthickness=1,
            highlightbackground="#e5e7eb",
            padx=10,
            pady=8,
        )
        promotion_card.grid(row=1, column=0, columnspan=2, sticky="nsew", pady=(0, 4))
        tk.Label(promotion_card, text="DADOS DO VOUCHER", bg="#ffffff", fg="#64748b", font=("Segoe UI", 8, "bold")).pack(anchor="w")
        tk.Label(
            promotion_card,
            textvariable=self.voucher_details_var,
            bg="#ffffff",
            fg="#0f172a",
            font=("Segoe UI", 9),
            justify="left",
            wraplength=300,
        ).pack(anchor="w", pady=(4, 0))

        tk.Label(
            self.details,
            text="Condicoes aprovadas",
            bg="#f8fafc",
            fg="#0f172a",
            font=("Segoe UI", 9, "bold"),
            anchor="w",
        ).pack(anchor="w", pady=(10, 0))
        self.conditions_text = tk.Text(
            self.details,
            height=5,
            width=68,
            wrap="word",
            bg="#ffffff",
            fg="#1f2937",
            relief="flat",
            borderwidth=1,
            highlightthickness=1,
            highlightbackground="#e5e7eb",
            padx=10,
            pady=8,
            font=("Segoe UI", 9),
        )
        self.conditions_text.pack(fill="both", expand=True, pady=(5, 0))
        self.conditions_text.configure(state="disabled")

        self.footer = ttk.Frame(card, style="Card.TFrame")
        self.footer.pack(side="bottom", fill="x", pady=(10, 4))

        footer_info = ttk.Frame(self.footer, style="Card.TFrame")
        footer_info.pack(side="left", fill="x", expand=True)

        self.footer_hint = ttk.Label(
            footer_info,
            text="F1 detalhes  |  F5 confirma  |  Esc cancela",
            style="Hint.TLabel",
        )
        self.footer_hint.pack(side="left")

        self.footer_actions = ttk.Frame(self.footer, style="Card.TFrame")
        self.footer_actions.pack(side="right")

        self.db_config_button = ttk.Button(
            self.footer_actions,
            text="Configurar banco local",
            style="Secondary.TButton",
            command=self._open_local_db_configuration,
        )

        self.cancel_button = ttk.Button(
            self.footer_actions,
            text="Cancelar",
            style="Secondary.TButton",
            command=self.on_cancel,
        )
        self.cancel_button.pack(side="right")

        self.confirm_button = ttk.Button(
            self.footer_actions,
            text="OK",
            style="Primary.TButton",
            command=self.on_confirm,
        )
        self.confirm_button.pack(side="right", padx=(0, 8))
        self.confirm_button_visible = True
        self._set_full_mode(False, force=True)

    def _bind_shortcuts(self) -> None:
        self.root.bind("<F5>", self._on_confirm_event)
        self.root.bind("<Escape>", self._on_cancel_event)
        self.root.bind("<F1>", self._on_toggle_details_event)
        self.voucher_entry.bind("<Return>", self._on_voucher_submit_event)
        self.voucher_entry.bind("<FocusOut>", self._on_voucher_focus_out)

    def _on_voucher_change(self, *_args) -> None:
        current_value = self.voucher_var.get()
        upper_value = current_value.upper()
        if current_value != upper_value:
            self.voucher_var.set(upper_value)
            return

        current_code = upper_value.strip()
        validated_code = ""
        if self.validated_voucher:
            validated_code = str(self.validated_voucher.get("shortCode") or "").strip().upper()

        if not current_code:
            self._reset_validation_result()
            self._set_validation_feedback("", "neutral")
            self.status_var.set("Informe o codigo do voucher.")
        elif validated_code and validated_code != current_code:
            self._reset_validation_result()
            self._set_validation_feedback("", "neutral")
            self.status_var.set("Codigo alterado. Revise e confirme.")
        elif not validated_code:
            self._set_validation_feedback("", "neutral")
        self._refresh_footer_actions()

    def _on_voucher_focus_out(self, _event=None) -> None:
        self.root.after(50, self._auto_validate_current_code)

    def _on_voucher_submit_event(self, _event=None):
        self._request_voucher_validation()
        return "break"

    def _on_toggle_details_event(self, _event=None):
        self._set_full_mode(not self.full_mode)
        return "break"

    def _set_full_mode(self, enabled: bool, force: bool = False) -> None:
        if self.full_mode == enabled and not force:
            return

        self.full_mode = enabled
        if enabled:
            if not self.status_strip.winfo_manager():
                self.status_strip.pack(fill="x", pady=(4, 6), after=self.hero)
            if not self.details.winfo_manager():
                self.details.pack(fill="both", expand=True, pady=(8, 0))
            if self.compact_actions.winfo_manager():
                self.compact_actions.pack_forget()
            if not self.footer.winfo_manager():
                self.footer.pack(side="bottom", fill="x", pady=(10, 4))
            if not self.db_config_button.winfo_manager():
                self.db_config_button.pack(side="left", padx=(0, 12))
            self.footer_hint.configure(text="F1 oculta detalhes  |  F5 confirma  |  Esc cancela")
            self.root.geometry(FULL_WINDOW_GEOMETRY)
            self.root.minsize(*FULL_WINDOW_SIZE)
        else:
            if self.status_strip.winfo_manager():
                self.status_strip.pack_forget()
            if self.compact_overview.winfo_manager():
                self.compact_overview.pack_forget()
            if self.details.winfo_manager():
                self.details.pack_forget()
            if self.db_config_button.winfo_manager():
                self.db_config_button.pack_forget()
            if self.footer.winfo_manager():
                self.footer.pack_forget()
            if not self.compact_actions.winfo_manager():
                self.compact_actions.pack(side="right")
            self.footer_hint.configure(text="F1 detalhes  |  F5 confirma  |  Esc cancela")
            self.root.geometry(MINIMAL_WINDOW_GEOMETRY)
            self.root.minsize(*MINIMAL_WINDOW_SIZE)

        self.root.update_idletasks()
        center_window(self.root)

    def _set_validation_feedback(self, message: str, tone: str = "neutral") -> None:
        color_map = {
            "neutral": "#6b7280",
            "success": "#15803d",
            "error": "#b91c1c",
            "pending": "#475569",
        }
        self.validation_feedback_var.set(message)
        self.validation_feedback_label.configure(fg=color_map.get(tone, "#6b7280"))

    def _reset_validation_result(self) -> None:
        self.validated_voucher = None
        self.authorization_created = False
        self.last_voucher_status = None
        self.summary_var.set("Aguardando validacao do voucher.")
        self.rule_var.set("")
        self.validity_var.set("")
        self.voucher_details_var.set("Os dados do voucher serao exibidos aqui apos a validacao do codigo.")
        self._set_conditions_text("As condicoes aprovadas serao exibidas aqui apos a validacao do codigo.")

    def _auto_validate_current_code(self) -> None:
        if self.is_busy or not self.root.winfo_viewable():
            return

        current_code = self.voucher_var.get().strip().upper()
        if not current_code:
            return

        if self.validated_voucher and self.validated_voucher.get("shortCode") == current_code:
            return

        if not self.agent_ready or not self.integration_ready:
            return

        self._request_voucher_validation()

    def _has_validated_current_code(self) -> bool:
        current_code = self.voucher_var.get().strip().upper()
        if not current_code or not self.validated_voucher:
            return False
        return str(self.validated_voucher.get("shortCode") or "").strip().upper() == current_code

    def _request_voucher_validation(self) -> None:
        current_code = self.voucher_var.get().strip().upper()
        if not current_code:
            self.status_var.set("Informe o codigo do voucher.")
            self.voucher_entry.focus_set()
            return

        if not self.agent_ready:
            self.status_var.set("Ative este PDV com o codigo gerado para a filial antes de usar o voucher.")
            self._ensure_agent_ready(silent=False)
            return

        if not self.integration_ready:
            self.status_var.set("Validando estrutura da integracao no banco...")
            self._ensure_integration_ready(silent=False)
            return

        if self._has_validated_current_code():
            self._refresh_footer_actions()
            return

        self._validate_voucher()

    def _refresh_local_db_summary(self) -> None:
        self.local_db_var.set(format_local_db_summary())

    def _complete_hidden_startup(self) -> None:
        self._refresh_local_db_health_indicator()
        self._ensure_agent_ready(silent=True)

    def _dispatch_on_ui_thread(self, callback) -> None:
        self.ui_dispatch_queue.put(callback)

    def _process_ui_dispatch_queue(self) -> None:
        while True:
            try:
                callback = self.ui_dispatch_queue.get_nowait()
            except queue.Empty:
                break

            callback()

        self.ui_dispatch_job = self.root.after(50, self._process_ui_dispatch_queue)

    def _apply_local_db_health_state(self, state: str, text: str) -> None:
        color_map = {
            "ok": "#15803d",
            "error": "#b91c1c",
            "pending": "#b45309",
            "checking": "#475569",
        }
        self.local_db_health_var.set(text)
        if hasattr(self, "local_db_health_label"):
            self.local_db_health_label.configure(fg=color_map.get(state, "#475569"))

    def _refresh_local_db_health_indicator(self) -> None:
        config = load_local_db_config()
        required_keys = ["host", "port", "user", "database"]
        if not all(str(config.get(key) or "").strip() for key in required_keys):
            self._apply_local_db_health_state("pending", "Conexao local pendente")
            return

        self._apply_local_db_health_state("checking", "Verificando conexao local...")

        def runner() -> None:
            state, text = get_local_db_health_state(config)
            self._dispatch_on_ui_thread(lambda: self._apply_local_db_health_state(state, text))

        threading.Thread(target=runner, daemon=True).start()

    def _open_local_db_configuration(self) -> None:
        if self.is_busy or self.agent_pairing_in_flight or self.bootstrap_in_flight:
            self.status_var.set("Aguarde o fluxo atual terminar antes de reconfigurar o banco local.")
            return

        dialog = LocalDbConfigDialog(self.root)
        result = dialog.show()
        if not result:
            return

        self._refresh_local_db_summary()
        self._refresh_local_db_health_indicator()
        self.status_var.set("Configuracao do banco local atualizada para este terminal.")
        if self.agent_ready and not self.integration_ready:
            self._ensure_integration_ready(silent=True)

    def _register_hotkey(self) -> None:
        user32 = ctypes.windll.user32
        # #region debug-point A:register-hotkey
        self.hotkey_registered = bool(user32.RegisterHotKey(None, HOTKEY_ID, MOD_NOREPEAT, VK_F9))
        debug_report(
            "A",
            "integracao_frota_app.py:_register_hotkey",
            "[DEBUG] RegisterHotKey executado",
            {"hotkey": HOTKEY_LABEL, "registered": self.hotkey_registered, "last_error": ctypes.GetLastError()},
        )
        # #endregion
        if not self.hotkey_registered:
            self.status_var.set("Nao foi possivel registrar o atalho global F9. O app segue disponivel manualmente.")

    def _start_hotkey_listener(self) -> None:
        if not self.hotkey_registered or self.hotkey_listener_thread:
            return

        def runner() -> None:
            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32
            self.hotkey_listener_thread_id = int(kernel32.GetCurrentThreadId())
            msg = ctypes.wintypes.MSG()
            while True:
                result = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
                if result <= 0:
                    break
                if msg.message == WM_HOTKEY and msg.wParam == HOTKEY_ID:
                    self._dispatch_on_ui_thread(self.show_window)

        self.hotkey_listener_thread = threading.Thread(target=runner, daemon=True)
        self.hotkey_listener_thread.start()

    def _poll_hotkey(self) -> None:
        msg = ctypes.wintypes.MSG()
        user32 = ctypes.windll.user32

        # Lemos apenas WM_HOTKEY para nao drenar mensagens normais do Tkinter.
        while user32.PeekMessageW(ctypes.byref(msg), None, WM_HOTKEY, WM_HOTKEY, PM_REMOVE):
            if msg.message == WM_HOTKEY and msg.wParam == HOTKEY_ID:
                debug_report(
                    "B",
                    "integracao_frota_app.py:_poll_hotkey",
                    "[DEBUG] WM_HOTKEY recebido",
                    {"message": int(msg.message), "wParam": int(msg.wParam), "lParam": int(msg.lParam)},
                )
                self.show_window()

        self.root.after(25, self._poll_hotkey)

    def _poll_hotkey_fallback(self) -> None:
        user32 = ctypes.windll.user32
        is_pressed = bool(user32.GetAsyncKeyState(VK_F9) & 0x8000)

        if is_pressed != self.hotkey_last_physical_state:
            debug_report(
                "D",
                "integracao_frota_app.py:_poll_hotkey_fallback",
                "[DEBUG] Estado fisico da tecla F9 mudou",
                {
                    "is_pressed": is_pressed,
                    "latched_pressed": self.hotkey_fallback_pressed,
                    "registered": self.hotkey_registered,
                    "window_state": str(self.root.state()),
                },
                run_id="post-fix",
            )
            self.hotkey_last_physical_state = is_pressed

        if is_pressed and not self.hotkey_fallback_pressed:
            # #region debug-point D:fallback-hotkey
            debug_report(
                "D",
                "integracao_frota_app.py:_poll_hotkey_fallback",
                "[DEBUG] Fallback GetAsyncKeyState detectou F9",
                {"hotkey": HOTKEY_LABEL, "registered": self.hotkey_registered},
                run_id="post-fix",
            )
            # #endregion
            self.show_window()

        self.hotkey_fallback_pressed = is_pressed
        self.root.after(25, self._poll_hotkey_fallback)

    def _poll_show_event(self) -> None:
        if self.show_event_handle:
            wait_result = ctypes.windll.kernel32.WaitForSingleObject(ctypes.c_void_p(self.show_event_handle), 0)
            if wait_result == WAIT_OBJECT_0:
                debug_report(
                    "E",
                    "integracao_frota_app.py:_poll_show_event",
                    "[DEBUG] Evento de segunda instancia solicitou reabertura da janela",
                    {"state_before": str(self.root.state())},
                    run_id="post-fix",
                )
                self.show_window()
        self.root.after(25, self._poll_show_event)

    def _set_busy(self, busy: bool) -> None:
        self.is_busy = busy
        self._update_interaction_state()

    def _update_interaction_state(self) -> None:
        interactive_state = "normal" if (self.agent_ready and self.integration_ready and not self.is_busy) else "disabled"
        self.confirm_button.configure(state=interactive_state)
        self.compact_confirm_button.configure(state=interactive_state)
        self.compact_cancel_button.configure(state="normal")
        self.voucher_entry.configure(state=interactive_state)
        self._refresh_footer_actions()

    def _refresh_footer_actions(self) -> None:
        self.confirm_button.configure(text="OK")
        self.compact_confirm_button.configure(text="OK")
        self.confirm_button_visible = True
        can_apply = (
            self.agent_ready
            and self.integration_ready
            and not self.is_busy
            and self._has_validated_current_code()
            and not self.authorization_created
        )
        confirm_state = "normal" if can_apply else "disabled"
        cancel_state = "disabled" if self.is_busy else "normal"
        self.confirm_button.configure(state=confirm_state)
        self.compact_confirm_button.configure(state=confirm_state)
        self.cancel_button.configure(state=cancel_state)
        self.compact_cancel_button.configure(state=cancel_state)

    def _run_async(self, worker, on_success, operation: str, on_error=None) -> None:
        if self.is_busy:
            return

        self.current_operation = operation
        self._set_busy(True)

        def runner() -> None:
            try:
                result = worker()
            except Exception as exc:  # noqa: BLE001
                message = str(exc)
                log_cashier_event(
                    logging.ERROR,
                    "async_worker_failed",
                    "Fluxo assíncrono do voucher falhou.",
                    {
                        "operation": operation,
                        "error": message,
                        "voucher": self._build_log_context(),
                    },
                    exc_info=exc,
                )
                self._dispatch_on_ui_thread(
                    lambda message=message, operation=operation, on_error=on_error: (
                        on_error(message) if callable(on_error) else self._handle_error(message, operation)
                    )
                )
                return

            self._dispatch_on_ui_thread(lambda: self._finish_async(on_success, result, operation))

        threading.Thread(target=runner, daemon=True).start()

    def _finish_async(self, callback, result, operation: str) -> None:
        self._set_busy(False)
        self.current_operation = "idle"
        callback(result)

    def _handle_error(self, message: str, operation: str | None = None) -> None:
        self._set_busy(False)
        self.current_operation = "idle"
        if not self.api.has_agent_credentials():
            self.agent_ready = False
            self.integration_ready = False
            self._update_interaction_state()
            self._refresh_promotion_sync_summary("Credencial do PDV ausente ou revogada. Ative este terminal novamente.")
        self.status_var.set(message)
        log_cashier_event(
            logging.ERROR,
            "voucher_flow_error",
            "A tela do PDV exibiu erro no fluxo de voucher.",
            {
                "operation": operation or "desconhecida",
                "message": message,
                "voucher": self._build_log_context(),
            },
        )
        # #region debug-point E:python-ui-error
        debug_report_cashier(
            "E",
            "integracao_frota_app.py:IntegracaoFrotaApp._handle_error",
            "[DEBUG] UI recebeu erro durante o fluxo de pre-autorizacao",
            {"message": message},
        )
        # #endregion
        messagebox.showerror("integração frota", message, parent=self.root)

    def _on_confirm_event(self, _event=None) -> None:
        self.on_confirm()

    def _on_cancel_event(self, _event=None) -> None:
        self.on_cancel()

    def on_confirm(self) -> None:
        current_code = self.voucher_var.get().strip().upper()
        if not current_code:
            self.status_var.set("Informe o codigo do voucher.")
            log_cashier_event(
                logging.WARNING,
                "confirm_blocked_missing_code",
                "Tentativa de validar voucher sem informar codigo.",
                {"voucher": self._build_log_context()},
            )
            self.voucher_entry.focus_set()
            return

        if not self._has_validated_current_code():
            self.status_var.set("Valide o codigo para visualizar as condicoes antes de aplicar o voucher.")
            self._request_voucher_validation()
            return

        if self.validated_voucher and self.validated_voucher["shortCode"] == current_code:
            log_cashier_event(
                logging.INFO,
                "confirm_authorize_requested",
                "Operador confirmou a pre-autorizacao do voucher.",
                {"voucher": self._build_log_context()},
            )
            self._authorize_voucher()
            return

    def on_cancel(self) -> None:
        self.hide_window()

    def show_window(self) -> None:
        now = time.monotonic()
        if now - self.last_show_at < 0.6:
            debug_report(
                "E",
                "integracao_frota_app.py:show_window",
                "[DEBUG] show_window ignorado por debounce",
                {"state_before": str(self.root.state()), "elapsed": round(now - self.last_show_at, 3)},
                run_id="post-fix",
            )
            return
        self.last_show_at = now
        # #region debug-point E:show-window
        debug_report(
            "E",
            "integracao_frota_app.py:show_window",
            "[DEBUG] show_window acionado",
            {"state_before": str(self.root.state())},
            run_id="post-fix",
        )
        # #endregion
        self._set_full_mode(False)
        self.root.state("normal")
        self.root.deiconify()
        center_window(self.root)
        self.root.lift()
        self.root.attributes("-topmost", True)
        self.root.after_idle(self.root.focus_force)
        if self.validated_voucher:
            self.root.after_idle(self.confirm_button.focus_force)
        else:
            self.root.after_idle(self.voucher_entry.focus_force)
        self.root.after(120, lambda: self.root.attributes("-topmost", False))
        self.root.after(180, lambda: self._ensure_agent_ready(silent=not self.root.winfo_viewable()))

    def hide_window(self) -> None:
        debug_report(
            "E",
            "integracao_frota_app.py:hide_window",
            "[DEBUG] ESC ocultou e resetou a tela do integrador",
            {"state_before": str(self.root.state()), "busy": self.is_busy},
            run_id="post-fix",
        )
        self._set_busy(False)
        self._clear_form()
        self.root.attributes("-topmost", False)
        self.root.update_idletasks()
        self.root.withdraw()

    def _clear_form(self) -> None:
        self._cancel_status_refresh()
        self.voucher_var.set("")
        self.conta_var.set(str(self.cashier_context.get("conta") or "Sera definida no cupom"))
        self.estacao_var.set(str(self.cashier_context.get("estacao") or "Identificando..."))
        self.summary_var.set("Aguardando validacao do voucher.")
        self.rule_var.set("")
        self.validity_var.set("")
        self.voucher_details_var.set("Os dados do voucher serao exibidos aqui apos a validacao do codigo.")
        self._set_conditions_text("As condicoes aprovadas serao exibidas aqui apos a validacao do codigo.")
        self._set_validation_feedback("", "neutral")
        self.status_var.set("Informe o codigo do voucher.")
        self.validated_voucher = None
        self.authorization_created = False
        self.current_operation = "idle"
        self.last_voucher_status = None
        self._set_full_mode(False)
        self._refresh_footer_actions()

    def _load_cached_promotions(self) -> None:
        cached = load_promotion_cache()
        self.synced_promotions = cached.get("items", [])
        self.last_promotion_sync_at = cached.get("serverTime")
        self.promotion_cursor = cached.get("promotionCursor")
        self._refresh_promotion_sync_summary()

    def _refresh_promotion_sync_summary(self, custom_message: str | None = None) -> None:
        if custom_message:
            self.promotion_sync_var.set(custom_message)
            return

        if not self.agent_ready:
            self.promotion_sync_var.set("PDV ainda nao ativado. Gere um codigo da filial e conclua o pareamento deste terminal.")
            return

        count = len(self.synced_promotions)
        readable_time = self._format_sync_time(self.last_promotion_sync_at)
        voucher_preview = ", ".join(
            str(item.get("voucherCode"))
            for item in self.synced_promotions[:3]
            if isinstance(item.get("voucherCode"), str) and item.get("voucherCode")
        )

        if count == 0:
            if readable_time:
                self.promotion_sync_var.set(f"Nenhuma promocao ativa em cache. Ultima sync: {readable_time}.")
            else:
                self.promotion_sync_var.set("Nenhuma promocao sincronizada para o PDV.")
            return

        suffix = f" Codigos: {voucher_preview}." if voucher_preview else ""
        if readable_time:
            self.promotion_sync_var.set(f"{count} promocao(oes) em cache. Ultima sync: {readable_time}.{suffix}")
        else:
            self.promotion_sync_var.set(f"{count} promocao(oes) em cache.{suffix}")

    def _format_sync_time(self, value: str | None) -> str | None:
        if not value:
            return None

        normalized = value.replace("Z", "+00:00")
        try:
            return dt.datetime.fromisoformat(normalized).astimezone().strftime("%d/%m/%Y %H:%M:%S")
        except ValueError:
            return value

    def _cancel_promotion_sync(self) -> None:
        if self.promotion_sync_job:
            self.root.after_cancel(self.promotion_sync_job)
            self.promotion_sync_job = None

    def _schedule_promotion_sync(self, delay_ms: int = PROMOTION_SYNC_INTERVAL_MS) -> None:
        self._cancel_promotion_sync()
        self.promotion_sync_job = self.root.after(delay_ms, self._sync_promotions)

    def _sync_promotions(self) -> None:
        self.promotion_sync_job = None
        # #region debug-point A:ui-sync-promotions-entry
        debug_report_cashier(
            "A",
            "integracao_frota_app.py:2000",
            "[DEBUG] Entrada no scheduler de sync de promocoes do PDV",
            {
                "agentReady": self.agent_ready,
                "integrationReady": self.integration_ready,
                "inFlight": self.promotion_sync_in_flight,
                "cursor": self.promotion_cursor,
            },
        )
        # #endregion
        if not self.agent_ready or not self.integration_ready or self.promotion_sync_in_flight:
            return

        self.promotion_sync_in_flight = True

        def runner() -> None:
            try:
                response = self.api.sync_promotions(self.promotion_cursor)
                # #region debug-point B:ui-sync-promotions-success
                debug_report_cashier(
                    "B",
                    "integracao_frota_app.py:2009",
                    "[DEBUG] Sync de promocoes retornou do backend",
                    {
                        "success": response.get("success"),
                        "promotionCursor": response.get("promotionCursor"),
                        "unchanged": response.get("unchanged"),
                        "itemCount": response.get("itemCount"),
                    },
                )
                # #endregion
                if not response.get("success"):
                    raise RuntimeError(response.get("error") or "Nao foi possivel sincronizar as promocoes do PDV.")
            except Exception as exc:  # noqa: BLE001
                # #region debug-point E:ui-sync-promotions-error
                debug_report_cashier(
                    "E",
                    "integracao_frota_app.py:2012",
                    "[DEBUG] Sync de promocoes falhou no app-py",
                    {
                        "message": str(exc),
                        "cursor": self.promotion_cursor,
                    },
                )
                # #endregion
                message = str(exc)
                self._dispatch_on_ui_thread(lambda message=message: self._apply_promotion_sync_error(message))
                return

            self._dispatch_on_ui_thread(lambda: self._apply_promotion_sync(response))

        threading.Thread(target=runner, daemon=True).start()

    def _apply_promotion_sync(self, response: dict) -> None:
        self.promotion_sync_in_flight = False
        self.last_promotion_sync_at = response.get("serverTime") if isinstance(response.get("serverTime"), str) else None
        cursor = response.get("promotionCursor")
        self.promotion_cursor = cursor if isinstance(cursor, int) else self.promotion_cursor
        if not response.get("unchanged"):
            items = response.get("items") if isinstance(response.get("items"), list) else []
            self.synced_promotions = [item for item in items if isinstance(item, dict)]
        save_promotion_cache(self.synced_promotions, self.last_promotion_sync_at, self.promotion_cursor)
        self._refresh_promotion_sync_summary()
        self._schedule_promotion_sync()

    def _apply_promotion_sync_error(self, message: str) -> None:
        self.promotion_sync_in_flight = False
        if not self.api.has_agent_credentials():
            self.agent_ready = False
            self.integration_ready = False
            self._update_interaction_state()
            self._refresh_promotion_sync_summary("Credencial do PDV ausente ou revogada. Ative este terminal novamente.")
            return
        if self.synced_promotions:
            self._refresh_promotion_sync_summary(
                f"{len(self.synced_promotions)} promocao(oes) em cache local. Falha na atualizacao: {message}"
            )
        else:
            self._refresh_promotion_sync_summary(f"Falha na sync do PDV: {message}")
        self._schedule_promotion_sync()

    def _ensure_integration_ready(self, silent: bool = False) -> None:
        if not self.agent_ready:
            self._ensure_agent_ready(silent=silent)
            return

        if self.bootstrap_in_flight:
            return

        self.bootstrap_in_flight = True
        self.integration_ready = False
        self._update_interaction_state()
        self.status_var.set("Validando estrutura da integracao no banco...")

        def runner() -> None:
            try:
                response = self.api.bootstrap()
                if not response.get("success"):
                    item = response.get("item", {}) if isinstance(response.get("item"), dict) else {}
                    checks = item.get("checks", []) if isinstance(item, dict) else []
                    first_failure = None
                    if isinstance(checks, list):
                        for check in checks:
                            if isinstance(check, dict) and not check.get("ok", False):
                                first_failure = check.get("details")
                                break
                    raise RuntimeError(
                        first_failure
                        or response.get("error")
                        or "A estrutura da integracao nao ficou pronta para uso."
                    )
            except Exception as exc:  # noqa: BLE001
                message = str(exc)
                self._dispatch_on_ui_thread(lambda message=message, silent=silent: self._apply_bootstrap_error(message, silent))
                return

            self._dispatch_on_ui_thread(lambda: self._apply_bootstrap_success())

        threading.Thread(target=runner, daemon=True).start()

    def _apply_bootstrap_success(self) -> None:
        self.bootstrap_in_flight = False
        self.integration_ready = True
        self._update_interaction_state()
        if not self.validated_voucher and not self.authorization_created:
            self.status_var.set("Estrutura validada. Informe o codigo do voucher.")
        self._refresh_context(silent=True)
        self._schedule_promotion_sync(1200)
        if not self.validated_voucher:
            self.voucher_entry.focus_force()

    def _apply_bootstrap_error(self, message: str, silent: bool) -> None:
        self.bootstrap_in_flight = False
        self.integration_ready = False
        self._update_interaction_state()
        friendly_message = f"Estrutura da integracao indisponivel: {message}"
        self.status_var.set(friendly_message)
        if not silent:
            messagebox.showerror("integração frota", friendly_message, parent=self.root)

    def _ensure_agent_ready(self, silent: bool = False) -> None:
        if self.agent_pairing_in_flight:
            return

        if self.api.has_agent_credentials():
            self.agent_ready = True
            self._update_interaction_state()
            self._refresh_promotion_sync_summary()
            if not self.integration_ready and not self.bootstrap_in_flight:
                self._ensure_integration_ready(silent=True)
            return

        self.agent_ready = False
        self.integration_ready = False
        self._update_interaction_state()
        self._refresh_promotion_sync_summary()
        self.status_var.set("Ative este PDV com o codigo gerado para a filial no painel web.")

        pairing_code = (os.getenv("FROTA_PAIRING_CODE") or "").strip()
        if not pairing_code and silent:
            return

        if not pairing_code:
            pairing_code = (
                simpledialog.askstring(
                    "ativação do pdv",
                    "Informe o codigo de ativacao deste PDV:",
                    parent=self.root,
                )
                or ""
            ).strip()
        if not pairing_code:
            return

        self.agent_pairing_in_flight = True
        self._set_busy(True)
        self.status_var.set("Ativando este PDV com a filial selecionada...")

        def runner() -> None:
            try:
                item = self.api.activate_agent(pairing_code)
            except Exception as exc:  # noqa: BLE001
                message = str(exc)
                self._dispatch_on_ui_thread(
                    lambda message=message, silent=silent: self._apply_agent_activation_error(message, silent)
                )
                return

            self._dispatch_on_ui_thread(lambda item=item: self._apply_agent_activation_success(item))

        threading.Thread(target=runner, daemon=True).start()

    def _apply_agent_activation_success(self, item: dict) -> None:
        self.agent_pairing_in_flight = False
        self._set_busy(False)
        self.agent_ready = True
        self.integration_ready = False
        self._update_interaction_state()
        agent = item.get("agent", {}) if isinstance(item.get("agent"), dict) else {}
        branch_id = str(agent.get("branchId") or "")
        station_code = str(agent.get("stationCode") or self.api.station_hint or "")
        self.status_var.set(f"PDV ativado para a filial {branch_id}. Validando estrutura da integracao...")
        if station_code:
            self.estacao_var.set(station_code)
        self._refresh_promotion_sync_summary("PDV ativado. Preparando a primeira sincronizacao.")
        self._ensure_integration_ready(silent=True)

    def _apply_agent_activation_error(self, message: str, silent: bool) -> None:
        self.agent_pairing_in_flight = False
        self._set_busy(False)
        self.agent_ready = False
        self.integration_ready = False
        self.api.clear_agent_credentials()
        self._update_interaction_state()
        self._refresh_promotion_sync_summary("Falha na ativacao do PDV. Gere um novo codigo e tente novamente.")
        friendly_message = f"Nao foi possivel ativar este PDV: {message}"
        self.status_var.set(friendly_message)
        if not silent:
            messagebox.showerror("integração frota", friendly_message, parent=self.root)

    def _refresh_context(self, silent: bool = False) -> None:
        if not self.integration_ready:
            return
        if self.context_refresh_in_flight:
            return
        if silent and (time.monotonic() - self.last_context_refresh_at) < CONTEXT_REFRESH_TTL_SECONDS:
            return

        self.context_refresh_in_flight = True

        def runner() -> None:
            try:
                response = self.api.get_context()
                if not response.get("success"):
                    raise RuntimeError(response.get("error") or "Nao foi possivel identificar o caixa aberto.")
            except Exception as exc:  # noqa: BLE001
                message = str(exc)
                self._dispatch_on_ui_thread(lambda message=message, silent=silent: self._apply_context_error(message, silent))
                return

            self._dispatch_on_ui_thread(lambda: self._apply_context(response.get("item", {})))

        threading.Thread(target=runner, daemon=True).start()

    def _apply_context(self, item: dict) -> None:
        self.context_refresh_in_flight = False
        self.last_context_refresh_at = time.monotonic()
        self.cashier_context = {
            "conta": item.get("conta"),
            "estacao": item.get("estacao"),
            "data": item.get("data"),
            "turno": item.get("turno"),
            "usuario": item.get("usuario"),
            "stationSource": item.get("stationSource"),
        }
        self.conta_var.set(str(item.get("conta") or "Sera definida no cupom"))
        self.estacao_var.set(str(item.get("estacao") or "Nao identificado"))
        log_cashier_event(
            logging.INFO,
            "cashier_context_updated",
            "Contexto atual do caixa foi atualizado.",
            {"cashierContext": dict(self.cashier_context)},
        )

    def _apply_context_error(self, message: str, silent: bool) -> None:
        self.context_refresh_in_flight = False
        self.cashier_context = {
            "conta": None,
            "estacao": None,
            "data": None,
            "turno": None,
            "usuario": None,
            "stationSource": None,
        }
        self.conta_var.set("Sera definida no cupom")
        self.estacao_var.set("Nao identificado")
        log_cashier_event(
            logging.WARNING,
            "cashier_context_error",
            "Falha ao atualizar o contexto atual do caixa.",
            {"message": message, "silent": silent},
        )
        if not silent and not self.validated_voucher:
            self.status_var.set(message)

    def _validate_voucher(self, after_success=None) -> None:
        short_code = self.voucher_var.get().strip().upper()
        self.status_var.set("Validando codigo no sistema...")
        self._set_validation_feedback("Validando codigo...", "pending")
        log_cashier_event(
            logging.INFO,
            "voucher_validation_started",
            "Validacao de voucher iniciada na tela do PDV.",
            {
                "shortCode": short_code,
                "voucher": self._build_log_context(),
            },
        )

        def worker() -> dict:
            promotion_sync: dict | None = None
            try:
                promotion_sync = self.api.sync_promotions()
            except Exception:  # noqa: BLE001
                promotion_sync = None

            response = self.api.validate_voucher(short_code)
            if not response.get("success"):
                raise RuntimeError(response.get("error") or "Voucher invalido.")
            if promotion_sync and promotion_sync.get("success"):
                response["_promotionSync"] = promotion_sync
            return response

        def on_success(response: dict) -> None:
            self._apply_validation(response)
            if callable(after_success):
                after_success()

        self._run_async(worker, on_success, operation="validacao_voucher", on_error=self._apply_validation_error)

    def _apply_validation(self, response: dict) -> None:
        promotion_sync = response.pop("_promotionSync", None)
        if isinstance(promotion_sync, dict):
            self._apply_promotion_sync(promotion_sync)

        voucher = {
            "shortCode": response.get("shortCode", self.voucher_var.get().strip().upper()),
            "authorization": response.get("authorization", {}),
        }
        authorization = voucher["authorization"]
        self.validated_voucher = voucher
        self.authorization_created = False
        self.summary_var.set(
            f"Voucher {voucher['shortCode']} validado com {authorization.get('discountPercent', 0)}% de desconto."
        )
        self.rule_var.set(self._build_rule_text(authorization))
        self.validity_var.set(self._build_validity_text(authorization))
        self.voucher_details_var.set(self._build_voucher_details_text(voucher, authorization))
        self._set_conditions_text(self._build_conditions_text(authorization))
        self._set_validation_feedback("Codigo validado", "success")
        self.status_var.set("Codigo validado. Pressione OK ou F5 para autorizar no caixa.")
        self.last_voucher_status = None
        log_cashier_event(
            logging.INFO,
            "voucher_validation_approved",
            "Voucher validado e liberado para pre-autorizacao.",
            {
                "shortCode": voucher["shortCode"],
                "authorization": authorization,
                "voucher": self._build_log_context(),
            },
        )
        self.confirm_button.focus_force()
        self._refresh_footer_actions()

    def _apply_validation_error(self, message: str) -> None:
        self._set_busy(False)
        self.current_operation = "idle"
        self._reset_validation_result()
        normalized = (message or "").strip()
        normalized_lower = normalized.lower()
        if "inval" in normalized_lower:
            self._set_validation_feedback("Codigo invalido", "error")
            self.status_var.set("Codigo invalido.")
            return

        self._set_validation_feedback(normalized or "Falha na validacao do codigo.", "error")
        self.status_var.set(normalized or "Falha na validacao do codigo.")

    def _set_conditions_text(self, text: str) -> None:
        self.conditions_text.configure(state="normal")
        self.conditions_text.delete("1.0", "end")
        self.conditions_text.insert("1.0", text)
        self.conditions_text.configure(state="disabled")

    def _build_voucher_details_text(self, voucher: dict, authorization: dict) -> str:
        lines = [
            f"Codigo: {voucher.get('shortCode', '')}",
            f"Desconto: {authorization.get('discountPercent', 0)}%",
            f"Escopo: {self._build_scope_summary(authorization)}",
            f"Status: {self._build_status_summary(authorization)}",
        ]
        promotion_name = str(authorization.get("promotionName") or "").strip()
        if promotion_name:
            lines.append(f"Promocao: {promotion_name}")
        if authorization.get("requireCustomerDocumentAtCashier"):
            document_type = str(authorization.get("issuedDocumentType") or "documento").upper()
            document_hint = str(authorization.get("issuedDocumentHint") or "").strip()
            suffix = f" ({document_hint})" if document_hint else ""
            lines.append(f"Validacao no caixa: exigir {document_type}{suffix}")
        return "\n".join(lines)

    def _build_scope_summary(self, authorization: dict) -> str:
        scope = authorization.get("scope", "ALL_PRODUCTS")
        product_codes = authorization.get("productCodes") or []
        product_group_codes = authorization.get("productGroupCodes") or []
        if scope == "PRODUCT" and product_codes:
            return f"Produtos {', '.join(str(item) for item in product_codes)}"
        if scope == "PRODUCT_GROUP" and product_group_codes:
            return f"Grupos {', '.join(str(item) for item in product_group_codes)}"
        return "Todos os produtos"

    def _build_status_summary(self, authorization: dict) -> str:
        status = str(authorization.get("status") or "ACTIVE").upper()
        label_map = {
            "ACTIVE": "Ativo",
            "EXPIRED": "Expirado",
            "CANCELLED": "Cancelado",
        }
        return label_map.get(status, status)

    def _join_condition_values(self, values: list) -> str:
        cleaned = [str(value).strip() for value in values if str(value).strip()]
        return ", ".join(cleaned) if cleaned else "Todos"

    def _format_condition_number(self, value) -> str:
        if value is None or value == "":
            return "Nao configurado"
        return str(value)

    def _build_conditions_text(self, authorization: dict) -> str:
        scope = authorization.get("scope", "ALL_PRODUCTS")
        product_codes = authorization.get("productCodes") or []
        product_group_codes = authorization.get("productGroupCodes") or []
        customer_codes = authorization.get("customerCodes") or []
        customer_group_codes = authorization.get("customerGroupCodes") or []
        selected_branch_ids = authorization.get("selectedBranchIds") or []
        payment_form_codes = authorization.get("paymentFormCodes") or []
        active_weekdays = authorization.get("activeWeekdays") or []
        lines: list[str] = []

        if scope == "PRODUCT":
            lines.append(f"Produtos: {self._join_condition_values(product_codes)}")
        elif scope == "PRODUCT_GROUP":
            lines.append(f"Grupos de produto: {self._join_condition_values(product_group_codes)}")

        if customer_codes:
            lines.append(f"Clientes especificos: {self._join_condition_values(customer_codes)}")

        if customer_group_codes:
            lines.append(f"Grupos de cliente: {self._join_condition_values(customer_group_codes)}")

        if authorization.get("firstPurchaseOnly"):
            lines.append("Primeira compra: Sim")

        if authorization.get("newCustomerDays"):
            lines.append(
                "Cliente novo por dias: "
                + self._format_condition_number(authorization.get("newCustomerDays"))
            )

        if selected_branch_ids:
            lines.append(f"Filiais liberadas: {self._join_condition_values(selected_branch_ids)}")

        if payment_form_codes:
            lines.append(f"Formas de pagamento: {self._join_condition_values(payment_form_codes)}")

        if active_weekdays:
            lines.append(f"Dias da semana: {self._join_condition_values(active_weekdays)}")

        start_time = authorization.get("startTime")
        end_time = authorization.get("endTime")
        if start_time or end_time:
            lines.append(f"Horario: {start_time or '--:--'} ate {end_time or '--:--'}")

        if authorization.get("birthdayOnly"):
            lines.append("Aniversario: Sim")

        if authorization.get("maxDiscountPerDay") is not None:
            lines.append(
                "Limite de desconto por dia: "
                + self._format_condition_number(authorization.get("maxDiscountPerDay"))
            )

        if authorization.get("maxVolumePerDay") is not None:
            lines.append(
                "Limite de volume por dia: "
                + self._format_condition_number(authorization.get("maxVolumePerDay"))
            )

        if authorization.get("maxQuantityPerItem") is not None:
            lines.append(
                "Quantidade maxima por item: "
                + self._format_condition_number(authorization.get("maxQuantityPerItem"))
            )

        if authorization.get("redemptionsPerCustomer") is not None:
            lines.append(
                "Resgates por cliente: "
                + self._format_condition_number(authorization.get("redemptionsPerCustomer"))
            )

        if authorization.get("maxPurchasesPerWeek") is not None:
            lines.append(
                "Compras por semana: "
                + self._format_condition_number(authorization.get("maxPurchasesPerWeek"))
            )

        if authorization.get("maxPurchasesPerMonth") is not None:
            lines.append(
                "Compras por mes: "
                + self._format_condition_number(authorization.get("maxPurchasesPerMonth"))
            )

        if authorization.get("reusable"):
            lines.append("Reutilizavel: Sim")

        if authorization.get("requireCustomerDocumentAtCashier"):
            document_type = str(authorization.get("issuedDocumentType") or "documento").upper()
            document_hint = str(authorization.get("issuedDocumentHint") or "").strip()
            suffix = f" ({document_hint})" if document_hint else ""
            lines.append(f"Confirmacao no caixa: {document_type}{suffix}")

        if not lines:
            return "Cupom aprovado sem restricoes adicionais."

        return "\n".join(lines)

    def _build_rule_text(self, authorization: dict) -> str:
        scope = authorization.get("scope", "ALL_PRODUCTS")
        product_codes = authorization.get("productCodes") or []
        product_group_codes = authorization.get("productGroupCodes") or []
        customer_codes = authorization.get("customerCodes") or []
        customer_group_codes = authorization.get("customerGroupCodes") or []
        payment_form_codes = authorization.get("paymentFormCodes") or []

        if scope == "PRODUCT" and product_codes:
            label = "Produto" if len(product_codes) == 1 else "Produtos"
            base_rule = f"{label} {', '.join(str(item) for item in product_codes)}"
        elif scope == "PRODUCT_GROUP" and product_group_codes:
            base_rule = f"Grupos de produto {', '.join(str(item) for item in product_group_codes)}"
        else:
            base_rule = "Todos os produtos"

        if customer_codes:
            customers = ", ".join(str(item) for item in customer_codes)
            base_rule = f"{base_rule} | Cliente {customers}" if len(customer_codes) == 1 else f"{base_rule} | Clientes {customers}"

        if customer_group_codes:
            customer_groups = ", ".join(str(item) for item in customer_group_codes)
            base_rule = f"{base_rule} | Grupos de cliente {customer_groups}"

        if payment_form_codes:
            payment_forms = ", ".join(str(item) for item in payment_form_codes)
            base_rule = (
                f"{base_rule} | Forma de pagamento {payment_forms}"
                if len(payment_form_codes) == 1
                else f"{base_rule} | Formas de pagamento {payment_forms}"
            )

        return base_rule

    def _build_validity_text(self, authorization: dict) -> str:
        valid_from = authorization.get("validFrom")
        valid_until = authorization.get("validUntil")

        if valid_from and valid_until:
            return f"De {valid_from} ate {valid_until}"
        if valid_until:
            return f"Valido ate {valid_until}"
        if valid_from:
            return f"Valido a partir de {valid_from}"
        return "Sem data final informada no gerador."

    def _build_log_context(self) -> dict:
        validated_short_code = None
        if isinstance(self.validated_voucher, dict):
            validated_short_code = self.validated_voucher.get("shortCode")
        return {
            "typedShortCode": self.voucher_var.get().strip().upper(),
            "validatedShortCode": validated_short_code,
            "authorizationCreated": self.authorization_created,
            "currentOperation": self.current_operation,
            "lastVoucherStatus": self.last_voucher_status,
            "cashierContext": dict(self.cashier_context),
        }

    def _authorize_voucher(self) -> None:
        if not self.validated_voucher:
            self.status_var.set("Valide o voucher antes de confirmar.")
            log_cashier_event(
                logging.WARNING,
                "voucher_authorization_blocked_without_validation",
                "Tentativa de pre-autorizar voucher sem validacao previa.",
                {"voucher": self._build_log_context()},
            )
            return

        resolved_estacao = self.cashier_context.get("estacao") if self.cashier_context else None
        resolved_conta = self.cashier_context.get("conta") if self.cashier_context else None
        authorization = self.validated_voucher.get("authorization", {}) if isinstance(self.validated_voucher, dict) else {}
        document_number = None
        if authorization.get("requireCustomerDocumentAtCashier"):
            document_type = str(authorization.get("issuedDocumentType") or "CPF/CNPJ").upper()
            document_hint = str(authorization.get("issuedDocumentHint") or "").strip()
            prompt = f"Informe o {document_type} do cliente"
            if document_hint:
                prompt += f" ({document_hint})"
            prompt += ":"
            document_number = (
                simpledialog.askstring(
                    "validação do voucher",
                    prompt,
                    parent=self.root,
                )
                or ""
            ).strip()
            if not document_number:
                self.status_var.set(f"Informe o {document_type} para autorizar este voucher.")
                self._set_validation_feedback(f"{document_type} obrigatorio", "error")
                return

        payload = {
            "shortCode": self.validated_voucher["shortCode"],
            "stationHint": self.api.station_hint or None,
            "estacao": resolved_estacao or None,
            "conta": resolved_conta or None,
            "documentNumber": document_number or None,
        }

        self.status_var.set("Registrando pre-autorizacao para o proximo item elegivel deste caixa...")
        log_cashier_event(
            logging.INFO,
            "voucher_authorization_started",
            "Pre-autorizacao do voucher iniciada.",
            {
                "payload": payload,
                "voucher": self._build_log_context(),
            },
        )
        # #region debug-point A:python-authorize-start
        debug_report_cashier(
            "A",
            "integracao_frota_app.py:IntegracaoFrotaApp._authorize_voucher",
            "[DEBUG] Segundo F5 acionou a pre-autorizacao no integrador",
            {
                "payload": payload,
                "busy": self.is_busy,
                "cashierContext": self.cashier_context,
            },
        )
        # #endregion

        def worker() -> dict:
            response = self.api.authorize_voucher(payload)
            if not response.get("success"):
                raise RuntimeError(response.get("error") or "Nao foi possivel registrar a pre-autorizacao.")
            return response

        self._run_async(worker, self._apply_authorization, operation="pre_autorizacao_voucher")

    def _apply_authorization(self, response: dict) -> None:
        item = response.get("item", {})
        self.authorization_created = True
        self.last_voucher_status = str(item.get("status") or "P")
        log_cashier_event(
            logging.INFO,
            "voucher_authorization_registered",
            "Pre-autorizacao registrada no backend do PDV.",
            {
                "item": item,
                "voucher": self._build_log_context(),
            },
        )
        # #region debug-point A:python-authorize-success
        debug_report_cashier(
            "A",
            "integracao_frota_app.py:IntegracaoFrotaApp._apply_authorization",
            "[DEBUG] Integrador recebeu sucesso da pre-autorizacao",
            {"item": item},
        )
        # #endregion
        self.status_var.set(
            f"Pre-autorizacao registrada. O proximo item elegivel deste caixa usara o voucher {item.get('shortCode', '')}."
        )
        if item.get("estacao"):
            self.estacao_var.set(str(item.get("estacao")))
        self.summary_var.set(
            f"Voucher {item.get('shortCode', '')} aguardando consumo na estacao {item.get('estacao', '')}."
        )
        self.root.after(150, self.hide_window)

    def _cancel_status_refresh(self) -> None:
        if self.status_poll_job:
            self.root.after_cancel(self.status_poll_job)
            self.status_poll_job = None

    def _schedule_status_refresh(self, delay_ms: int) -> None:
        self._cancel_status_refresh()
        self.status_poll_job = self.root.after(delay_ms, self._refresh_status)

    def _refresh_status(self) -> None:
        self.status_poll_job = None
        if not self.authorization_created or not self.validated_voucher:
            return

        short_code = self.validated_voucher["shortCode"]
        log_cashier_event(
            logging.INFO,
            "voucher_status_poll_started",
            "Consulta de status do voucher enviada para a API.",
            {
                "shortCode": short_code,
                "voucher": self._build_log_context(),
            },
        )

        def worker() -> dict:
            response = self.api.get_status(short_code)
            if not response.get("success"):
                raise RuntimeError(response.get("error") or "Nao foi possivel consultar o status.")
            return response

        self._run_async(worker, self._apply_status, operation="consulta_status_voucher")

    def _apply_status(self, response: dict) -> None:
        item = response.get("item", {})
        status = item.get("status", "P")
        previous_status = self.last_voucher_status
        self.last_voucher_status = str(status)
        if status == "R":
            self.status_var.set("Desconto reservado no cupom do AutoSystem.")
        elif status == "A":
            self.status_var.set("Desconto aplicado com sucesso.")
        elif status == "E":
            self.status_var.set(item.get("error") or "A integracao retornou erro.")
        else:
            self.status_var.set(f"Pre-autorizacao registrada com status {status}.")
        log_cashier_event(
            logging.INFO if status in ("P", "R", "A") else logging.WARNING,
            "voucher_status_updated",
            "Status do voucher atualizado na tela do PDV.",
            {
                "previousStatus": previous_status,
                "currentStatus": status,
                "statusItem": item,
                "voucher": self._build_log_context(),
            },
        )

        if status in ("P", "R") and self.authorization_created and self.validated_voucher:
            self._schedule_status_refresh(2000)

    def shutdown(self) -> None:
        self._cancel_promotion_sync()
        self._cancel_status_refresh()
        if self.ui_dispatch_job:
            self.root.after_cancel(self.ui_dispatch_job)
            self.ui_dispatch_job = None
        if self.hotkey_listener_thread_id:
            ctypes.windll.user32.PostThreadMessageW(self.hotkey_listener_thread_id, WM_QUIT, 0, 0)
            self.hotkey_listener_thread_id = 0
        if self.hotkey_registered:
            ctypes.windll.user32.UnregisterHotKey(None, HOTKEY_ID)
        release_handle(self.show_event_handle)


def main() -> None:
    log_cashier_event(
        logging.INFO,
        "app_started",
        "Aplicativo de integracao do PDV iniciado.",
        {
            "installDir": str(APP_INSTALL_DIR),
            "appDataDir": str(APP_DATA_DIR),
            "logFile": str(LOG_FILE),
            "backupDir": str(LOG_BACKUP_DIR),
        },
    )
    # #region debug-point A:main-start
    debug_report(
        "A",
        "integracao_frota_app.py:main",
        "[DEBUG] Main do integrador Python iniciado",
        {},
    )
    # #endregion
    mutex_handle = acquire_single_instance_mutex()
    if not mutex_handle:
        signal_sent = signal_existing_instance()
        log_cashier_event(
            logging.WARNING,
            "app_single_instance_blocked",
            "Segunda instancia do app foi bloqueada pelo mutex global.",
            {"mutex": SINGLE_INSTANCE_MUTEX, "signalSent": signal_sent},
        )
        debug_report(
            "F",
            "integracao_frota_app.py:main",
            "[DEBUG] Segunda instancia bloqueada pelo mutex global",
            {"mutex": SINGLE_INSTANCE_MUTEX, "signal_sent": signal_sent},
            run_id="post-fix",
        )
        return

    show_event_handle = create_show_event()
    root = tk.Tk()
    # #region debug-point A:root-withdraw
    debug_report(
        "A",
        "integracao_frota_app.py:main",
        "[DEBUG] Root Tk inicializado e ocultado antes da validacao inicial",
        {"state": str(root.state())},
    )
    # #endregion

    if not ensure_local_db_configuration(root):
        log_cashier_event(
            logging.WARNING,
            "app_closed_missing_local_db_config",
            "Aplicativo encerrado porque a configuracao do banco local nao foi concluida.",
            {},
        )
        # #region debug-point A:early-exit
        debug_report(
            "A",
            "integracao_frota_app.py:main",
            "[DEBUG] App encerrado antes do mainloop porque a configuracao local nao foi concluida",
            {},
        )
        # #endregion
        release_handle(show_event_handle)
        root.destroy()
        release_single_instance_mutex(mutex_handle)
        return

    app = IntegracaoFrotaApp(root, show_event_handle=show_event_handle)
    # #region debug-point A:mainloop-enter
    debug_report(
        "A",
        "integracao_frota_app.py:main",
        "[DEBUG] Entrando no mainloop do Tkinter",
        {"agent_ready": app.agent_ready, "integration_ready": app.integration_ready},
    )
    # #endregion

    def on_exit() -> None:
        app.shutdown()
        root.destroy()
        release_single_instance_mutex(mutex_handle)

    root.protocol("WM_DELETE_WINDOW", app.hide_window)
    root.bind("<Control-Shift-Q>", lambda _event: on_exit())
    root.mainloop()


if __name__ == "__main__":
    main()
