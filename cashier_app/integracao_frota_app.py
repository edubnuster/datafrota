import ctypes
import ctypes.wintypes
import datetime as dt
import json
import os
import socket
import threading
import time
import tkinter as tk
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
PM_REMOVE = 0x0001
MOD_NOREPEAT = 0x4000
VK_F9 = 0x78
HOTKEY_ID = 1
HOTKEY_LABEL = "F9"
DEBUG_SESSION_ENV = ".dbg/cashier-preauth-stuck.env"
SINGLE_INSTANCE_MUTEX = "Global\\IntegracaoFrotaSingleInstance"
SHOW_WINDOW_EVENT = "Global\\IntegracaoFrotaShowWindow"
EVENT_MODIFY_STATE = 0x0002
SYNCHRONIZE = 0x00100000
WAIT_OBJECT_0 = 0x00000000
CONTEXT_REFRESH_TTL_SECONDS = 15.0
PROMOTION_SYNC_INTERVAL_MS = 60000
PROMOTION_CACHE_FILE = os.path.join(os.path.dirname(__file__), "pdv_promotions_cache.json")
AGENT_CREDENTIALS_FILE = os.path.join(os.path.dirname(__file__), "pdv_agent_credentials.json")
LOCAL_DB_CONFIG_FILE = os.path.join(os.path.dirname(__file__), "local_db_config.json")


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

    try:
        req = request.Request(
            debug_server_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(req, timeout=1.0):
            pass
    except Exception:
        pass


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
        return {"items": [], "serverTime": None}

    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    return {
        "items": [item for item in items if isinstance(item, dict)],
        "serverTime": payload.get("serverTime") if isinstance(payload.get("serverTime"), str) else None,
    }


def save_promotion_cache(items: list[dict], server_time: str | None) -> None:
    payload = {
        "serverTime": server_time,
        "savedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "items": items,
    }
    try:
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

    def sync_promotions(self) -> dict:
        return self._request("GET", f"{self.base_url}/pdv-agents/me/sync")

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
        self.last_context_refresh_at = 0.0
        self.context_refresh_in_flight = False
        self.status_poll_job = None
        self.promotion_sync_job = None
        self.promotion_sync_in_flight = False
        self.synced_promotions: list[dict] = []
        self.last_promotion_sync_at: str | None = None

        self.root.title("integração frota")
        self.root.geometry("760x620")
        self.root.minsize(760, 620)
        self.root.resizable(False, False)
        self.root.configure(bg="#efefef")
        self.root.protocol("WM_DELETE_WINDOW", self.hide_window)
        self.root.withdraw()

        self.voucher_var = tk.StringVar()
        self.conta_var = tk.StringVar(value="Sera definida no cupom")
        self.estacao_var = tk.StringVar(value="Identificando...")
        self.status_var = tk.StringVar(value="Informe o voucher do app frota.")
        self.summary_var = tk.StringVar(value="Aguardando validacao do voucher.")
        self.rule_var = tk.StringVar(value="")
        self.validity_var = tk.StringVar(value="")
        self.local_db_var = tk.StringVar(value=format_local_db_summary())
        self.local_db_health_var = tk.StringVar(value="Verificando conexao local...")
        self.promotion_sync_var = tk.StringVar(value="Promocoes do PDV ainda nao sincronizadas.")

        self._load_cached_promotions()

        self._build_styles()
        self._build_layout()
        self.voucher_var.trace_add("write", self._on_voucher_change)
        self._clear_form()
        self._refresh_local_db_health_indicator()
        self._update_interaction_state()
        self._bind_shortcuts()
        self._register_hotkey()
        self._poll_hotkey()
        self._poll_hotkey_fallback()
        self._poll_show_event()
        self._ensure_agent_ready(silent=True)

    def _build_styles(self) -> None:
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Main.TFrame", background="#efefef")
        style.configure("Card.TFrame", background="#ffffff", relief="flat")
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
            foreground="#6b7280",
            font=("Segoe UI", 9),
        )
        style.configure("Visual.TLabel", background="#d8d2ba", foreground="#1f2937", font=("Segoe UI", 11, "bold"))
        style.configure("Primary.TButton", font=("Segoe UI", 10, "bold"))
        style.configure("Secondary.TButton", font=("Segoe UI", 10))

    def _build_layout(self) -> None:
        outer = ttk.Frame(self.root, style="Main.TFrame", padding=14)
        outer.pack(fill="both", expand=True)

        card = ttk.Frame(outer, style="Card.TFrame", padding=12)
        card.pack(fill="both", expand=True)

        content = ttk.Frame(card, style="Card.TFrame")
        content.pack(fill="both", expand=True)
        content.columnconfigure(0, weight=1)

        header_frame = ttk.Frame(content, style="Card.TFrame")
        header_frame.grid(row=0, column=0, sticky="ew")

        ttk.Label(header_frame, text="informe o voucher do app frota", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            header_frame,
            text=f"Digite o voucher e confirme com F5. O atalho global sugerido para abrir o app e {HOTKEY_LABEL}.",
            style="Hint.TLabel",
            wraplength=560,
        ).pack(anchor="w", pady=(4, 10))

        self.voucher_entry = ttk.Entry(header_frame, textvariable=self.voucher_var, font=("Segoe UI", 15), width=22)
        self.voucher_entry.pack(fill="x", ipady=4)

        details = ttk.Frame(content, style="Card.TFrame")
        details.grid(row=1, column=0, sticky="nsew", pady=(12, 0))
        details.columnconfigure(1, weight=1)
        details.columnconfigure(3, weight=1)

        ttk.Label(details, text="Resumo", style="Body.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(details, textvariable=self.summary_var, style="Body.TLabel", wraplength=330).grid(
            row=0, column=1, columnspan=3, sticky="w", padx=(8, 0)
        )

        ttk.Label(details, text="Regra", style="Body.TLabel").grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Label(details, textvariable=self.rule_var, style="Body.TLabel", wraplength=330).grid(
            row=1, column=1, columnspan=3, sticky="w", padx=(8, 0), pady=(8, 0)
        )

        ttk.Label(details, text="Validade", style="Body.TLabel").grid(row=2, column=0, sticky="w", pady=(8, 0))
        ttk.Label(details, textvariable=self.validity_var, style="Body.TLabel").grid(
            row=2, column=1, columnspan=3, sticky="w", padx=(8, 0), pady=(8, 0)
        )

        ttk.Label(details, text="Conta", style="Body.TLabel").grid(row=3, column=0, sticky="w", pady=(10, 0))
        ttk.Label(details, textvariable=self.conta_var, style="Body.TLabel").grid(
            row=3, column=1, sticky="w", padx=(8, 14), pady=(10, 0)
        )

        ttk.Label(details, text="Estacao", style="Body.TLabel").grid(row=3, column=2, sticky="w", pady=(10, 0))
        ttk.Label(details, textvariable=self.estacao_var, style="Body.TLabel").grid(
            row=3, column=3, sticky="w", padx=(8, 0), pady=(10, 0)
        )

        ttk.Label(details, text="Sync PDV", style="Body.TLabel").grid(row=4, column=0, sticky="w", pady=(10, 0))
        ttk.Label(details, textvariable=self.promotion_sync_var, style="Hint.TLabel", wraplength=330).grid(
            row=4, column=1, columnspan=3, sticky="w", padx=(8, 0), pady=(10, 0)
        )

        ttk.Label(details, text="Banco local", style="Body.TLabel").grid(row=5, column=0, sticky="w", pady=(10, 0))
        local_db_frame = ttk.Frame(details, style="Card.TFrame")
        local_db_frame.grid(row=5, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=(10, 0))
        local_db_frame.columnconfigure(0, weight=1)

        ttk.Label(local_db_frame, textvariable=self.local_db_var, style="Hint.TLabel", wraplength=330).grid(
            row=0, column=0, sticky="w"
        )
        self.local_db_health_label = tk.Label(
            local_db_frame,
            textvariable=self.local_db_health_var,
            bg="#ffffff",
            fg="#b45309",
            font=("Segoe UI", 9, "bold"),
        )
        self.local_db_health_label.grid(row=1, column=0, sticky="w", pady=(4, 0))

        ttk.Label(details, text="Condições", style="Body.TLabel").grid(row=6, column=0, sticky="nw", pady=(12, 0))
        self.conditions_text = tk.Text(
            details,
            height=12,
            width=68,
            wrap="word",
            bg="#f8fafc",
            fg="#1f2937",
            relief="flat",
            borderwidth=1,
            padx=10,
            pady=8,
            font=("Segoe UI", 9),
        )
        self.conditions_text.grid(row=6, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=(12, 0))
        self.conditions_text.configure(state="disabled")

        self.status_label = ttk.Label(
            details,
            textvariable=self.status_var,
            style="Hint.TLabel",
            wraplength=560,
        )
        self.status_label.grid(row=7, column=0, columnspan=4, sticky="w", pady=(12, 0))

        self.footer = ttk.Frame(card, style="Card.TFrame")
        self.footer.pack(fill="x", pady=(8, 0))

        self.db_config_button = ttk.Button(
            self.footer,
            text="Configurar banco local",
            style="Secondary.TButton",
            command=self._open_local_db_configuration,
        )
        self.db_config_button.pack(side="left", padx=(0, 10))

        self.footer_hint = ttk.Label(
            self.footer,
            text="Use F5 para validar/autorizar. ESC fecha a tela.",
            style="Hint.TLabel",
        )
        self.footer_hint.pack(side="left")

        self.confirm_button = ttk.Button(
            self.footer,
            text="Validar voucher - F5",
            style="Primary.TButton",
            command=self.on_confirm,
        )
        self.confirm_button.pack(side="right")
        self.confirm_button_visible = True

    def _bind_shortcuts(self) -> None:
        self.root.bind("<F5>", self._on_confirm_event)
        self.root.bind("<Escape>", self._on_cancel_event)
        self.voucher_entry.bind("<Return>", self._on_confirm_event)

    def _on_voucher_change(self, *_args) -> None:
        self._refresh_footer_actions()

    def _refresh_local_db_summary(self) -> None:
        self.local_db_var.set(format_local_db_summary())

    def _apply_local_db_health_state(self, state: str, text: str) -> None:
        color_map = {
            "ok": "#15803d",
            "error": "#b91c1c",
            "pending": "#b45309",
            "checking": "#475569",
        }
        self.local_db_health_var.set(text)
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
            self.root.after(0, lambda: self._apply_local_db_health_state(state, text))

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

        self.root.after(120, self._poll_hotkey)

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
        self.root.after(90, self._poll_hotkey_fallback)

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
        self.root.after(120, self._poll_show_event)

    def _set_busy(self, busy: bool) -> None:
        self.is_busy = busy
        self._update_interaction_state()

    def _update_interaction_state(self) -> None:
        interactive_state = "normal" if (self.agent_ready and self.integration_ready and not self.is_busy) else "disabled"
        self.confirm_button.configure(state=interactive_state)
        self.voucher_entry.configure(state=interactive_state)
        self._refresh_footer_actions()

    def _refresh_footer_actions(self) -> None:
        if self.validated_voucher:
            self.confirm_button.configure(text="Autorizar no caixa - F5")
        else:
            self.confirm_button.configure(text="Validar voucher - F5")

        should_show_confirm = bool(self.validated_voucher) or bool(self.voucher_var.get().strip())
        if should_show_confirm and not self.confirm_button_visible:
            self.confirm_button.pack(side="right")
            self.confirm_button_visible = True
        elif not should_show_confirm and self.confirm_button_visible:
            self.confirm_button.pack_forget()
            self.confirm_button_visible = False

    def _run_async(self, worker, on_success) -> None:
        if self.is_busy:
            return

        self._set_busy(True)

        def runner() -> None:
            try:
                result = worker()
            except Exception as exc:  # noqa: BLE001
                message = str(exc)
                self.root.after(0, lambda message=message: self._handle_error(message))
                return

            self.root.after(0, lambda: self._finish_async(on_success, result))

        threading.Thread(target=runner, daemon=True).start()

    def _finish_async(self, callback, result) -> None:
        self._set_busy(False)
        callback(result)

    def _handle_error(self, message: str) -> None:
        self._set_busy(False)
        if not self.api.has_agent_credentials():
            self.agent_ready = False
            self.integration_ready = False
            self._update_interaction_state()
            self._refresh_promotion_sync_summary("Credencial do PDV ausente ou revogada. Ative este terminal novamente.")
        self.status_var.set(message)
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
        if not self.agent_ready:
            self.status_var.set("Ative este PDV com o codigo gerado para a filial antes de usar o voucher.")
            self._ensure_agent_ready(silent=False)
            return

        if not self.integration_ready:
            self.status_var.set("Validando estrutura da integracao no banco...")
            self._ensure_integration_ready(silent=False)
            return

        current_code = self.voucher_var.get().strip().upper()
        if not current_code:
            self.status_var.set("Informe o voucher do app frota.")
            self.voucher_entry.focus_set()
            return

        if self.validated_voucher and self.validated_voucher["shortCode"] == current_code:
            self._authorize_voucher()
            return

        self._validate_voucher()

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
        self.root.state("normal")
        self.root.deiconify()
        self.root.geometry("760x620")
        self.root.update_idletasks()
        self.root.update()
        self.root.lift()
        self.root.attributes("-topmost", True)
        self.root.focus_force()
        if self.validated_voucher:
            self.confirm_button.focus_force()
        else:
            self.voucher_entry.focus_force()
        self.root.after(250, lambda: self.root.attributes("-topmost", False))
        self.root.after(50, self.root.update_idletasks)
        self.root.after(120, self.root.update)
        self.root.after(120, lambda: self._ensure_agent_ready(silent=not self.root.winfo_viewable()))

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
        self._set_conditions_text("As condicoes validadas da promocao serao exibidas aqui apos o primeiro F5.")
        self.status_var.set("Informe o voucher do app frota.")
        self.validated_voucher = None
        self.authorization_created = False
        self._refresh_footer_actions()

    def _load_cached_promotions(self) -> None:
        cached = load_promotion_cache()
        self.synced_promotions = cached.get("items", [])
        self.last_promotion_sync_at = cached.get("serverTime")
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
        if not self.agent_ready or not self.integration_ready or self.promotion_sync_in_flight:
            return

        self.promotion_sync_in_flight = True

        def runner() -> None:
            try:
                response = self.api.sync_promotions()
                if not response.get("success"):
                    raise RuntimeError(response.get("error") or "Nao foi possivel sincronizar as promocoes do PDV.")
            except Exception as exc:  # noqa: BLE001
                message = str(exc)
                self.root.after(0, lambda message=message: self._apply_promotion_sync_error(message))
                return

            self.root.after(0, lambda: self._apply_promotion_sync(response))

        threading.Thread(target=runner, daemon=True).start()

    def _apply_promotion_sync(self, response: dict) -> None:
        self.promotion_sync_in_flight = False
        items = response.get("items") if isinstance(response.get("items"), list) else []
        self.synced_promotions = [item for item in items if isinstance(item, dict)]
        self.last_promotion_sync_at = response.get("serverTime") if isinstance(response.get("serverTime"), str) else None
        save_promotion_cache(self.synced_promotions, self.last_promotion_sync_at)
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
                self.root.after(0, lambda message=message, silent=silent: self._apply_bootstrap_error(message, silent))
                return

            self.root.after(0, lambda: self._apply_bootstrap_success())

        threading.Thread(target=runner, daemon=True).start()

    def _apply_bootstrap_success(self) -> None:
        self.bootstrap_in_flight = False
        self.integration_ready = True
        self._update_interaction_state()
        if not self.validated_voucher and not self.authorization_created:
            self.status_var.set("Estrutura validada. Informe o voucher do app frota.")
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
                self.root.after(0, lambda message=message, silent=silent: self._apply_agent_activation_error(message, silent))
                return

            self.root.after(0, lambda item=item: self._apply_agent_activation_success(item))

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
                self.root.after(0, lambda message=message, silent=silent: self._apply_context_error(message, silent))
                return

            self.root.after(0, lambda: self._apply_context(response.get("item", {})))

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
        if not silent and not self.validated_voucher:
            self.status_var.set(message)

    def _validate_voucher(self) -> None:
        short_code = self.voucher_var.get().strip().upper()
        self.status_var.set("Validando voucher no sistema...")

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

        self._run_async(worker, self._apply_validation)

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
        self._set_conditions_text(self._build_conditions_text(authorization))
        self.status_var.set("Voucher validado. Pressione F5 para autorizar no caixa atual.")
        self.confirm_button.focus_force()
        self._refresh_footer_actions()

    def _set_conditions_text(self, text: str) -> None:
        self.conditions_text.configure(state="normal")
        self.conditions_text.delete("1.0", "end")
        self.conditions_text.insert("1.0", text)
        self.conditions_text.configure(state="disabled")

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
        else:
            lines.append("Produtos: Todos os produtos")

        lines.append(f"Clientes especificos: {self._join_condition_values(customer_codes)}")
        lines.append(f"Grupos de cliente: {self._join_condition_values(customer_group_codes)}")
        lines.append(
            "Primeira compra: "
            + ("Sim" if authorization.get("firstPurchaseOnly") else "Nao")
        )
        lines.append(
            "Cliente novo por dias: "
            + self._format_condition_number(authorization.get("newCustomerDays"))
        )
        lines.append(f"Filiais liberadas: {self._join_condition_values(selected_branch_ids)}")
        lines.append(f"Formas de pagamento: {self._join_condition_values(payment_form_codes)}")
        lines.append(f"Dias da semana: {self._join_condition_values(active_weekdays)}")

        start_time = authorization.get("startTime")
        end_time = authorization.get("endTime")
        if start_time or end_time:
            lines.append(f"Horario: {start_time or '--:--'} ate {end_time or '--:--'}")
        else:
            lines.append("Horario: Livre")

        if authorization.get("birthdayOnly"):
            lines.append("Aniversario: Validado no app DataFrota; nao e validado localmente no caixa/PDV")
        else:
            lines.append("Aniversario: Nao configurado")

        lines.append(
            "Limite de desconto por dia: "
            + self._format_condition_number(authorization.get("maxDiscountPerDay"))
        )
        lines.append(
            "Limite de volume por dia: "
            + self._format_condition_number(authorization.get("maxVolumePerDay"))
        )
        lines.append(
            "Quantidade maxima por item: "
            + self._format_condition_number(authorization.get("maxQuantityPerItem"))
        )
        lines.append(
            "Resgates por cliente: "
            + self._format_condition_number(authorization.get("redemptionsPerCustomer"))
        )
        lines.append(
            "Compras por semana: "
            + self._format_condition_number(authorization.get("maxPurchasesPerWeek"))
        )
        lines.append(
            "Compras por mes: "
            + self._format_condition_number(authorization.get("maxPurchasesPerMonth"))
        )
        lines.append(
            "Reutilizavel: "
            + ("Sim" if authorization.get("reusable") else "Nao")
        )

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

    def _authorize_voucher(self) -> None:
        if not self.validated_voucher:
            self.status_var.set("Valide o voucher antes de confirmar.")
            return

        resolved_estacao = self.cashier_context.get("estacao") if self.cashier_context else None
        resolved_conta = self.cashier_context.get("conta") if self.cashier_context else None

        payload = {
            "shortCode": self.validated_voucher["shortCode"],
            "stationHint": self.api.station_hint or None,
            "estacao": resolved_estacao or None,
            "conta": resolved_conta or None,
        }

        self.status_var.set("Registrando pre-autorizacao para o proximo item elegivel deste caixa...")
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

        self._run_async(worker, self._apply_authorization)

    def _apply_authorization(self, response: dict) -> None:
        item = response.get("item", {})
        self.authorization_created = True
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
        self._schedule_status_refresh(3500)

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

        def worker() -> dict:
            response = self.api.get_status(short_code)
            if not response.get("success"):
                raise RuntimeError(response.get("error") or "Nao foi possivel consultar o status.")
            return response

        self._run_async(worker, self._apply_status)

    def _apply_status(self, response: dict) -> None:
        item = response.get("item", {})
        status = item.get("status", "P")
        if status == "R":
            self.status_var.set("Desconto reservado no cupom do AutoSystem.")
        elif status == "A":
            self.status_var.set("Desconto aplicado com sucesso.")
        elif status == "E":
            self.status_var.set(item.get("error") or "A integracao retornou erro.")
        else:
            self.status_var.set(f"Pre-autorizacao registrada com status {status}.")

        if status in ("P", "R") and self.authorization_created and self.validated_voucher:
            self._schedule_status_refresh(2000)

    def shutdown(self) -> None:
        self._cancel_promotion_sync()
        self._cancel_status_refresh()
        if self.hotkey_registered:
            ctypes.windll.user32.UnregisterHotKey(None, HOTKEY_ID)
        release_handle(self.show_event_handle)


def main() -> None:
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
    root.after(0, app.show_window)
    root.mainloop()


if __name__ == "__main__":
    main()
