import ctypes
import ctypes.wintypes
import json
import os
import threading
import time
import tkinter as tk
from tkinter import messagebox, ttk
from urllib import error, parse, request


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
        debug_session_id = "hotkey-f9"
        try:
            with open(".dbg/hotkey-f9.env", encoding="utf-8") as env_file:
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


class FrotaApiClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.station_hint = (
            os.getenv("FROTA_STATION_HINT")
            or os.getenv("COMPUTERNAME")
            or os.getenv("HOSTNAME")
            or ""
        ).strip()

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

    def _request(self, method: str, url: str, payload: dict | None = None) -> dict:
        data = None
        headers = {"Accept": "application/json"}

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
        self.integration_ready = False
        self.bootstrap_in_flight = False
        self.hotkey_registered = False
        self.hotkey_fallback_pressed = False
        self.hotkey_last_physical_state = False
        self.last_show_at = 0.0
        self.last_context_refresh_at = 0.0
        self.context_refresh_in_flight = False
        self.status_poll_job = None

        self.root.title("integração frota")
        self.root.geometry("640x420")
        self.root.minsize(640, 420)
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

        self._build_styles()
        self._build_layout()
        self._clear_form()
        self._update_interaction_state()
        self._bind_shortcuts()
        self._register_hotkey()
        self._poll_hotkey()
        self._poll_hotkey_fallback()
        self._poll_show_event()
        self._ensure_integration_ready(silent=True)

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
            wraplength=350,
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

        self.status_label = ttk.Label(
            details,
            textvariable=self.status_var,
            style="Hint.TLabel",
            wraplength=330,
        )
        self.status_label.grid(row=4, column=0, columnspan=4, sticky="w", pady=(12, 0))

        footer = ttk.Frame(card, style="Card.TFrame")
        footer.pack(fill="x", pady=(12, 0))

        self.confirm_button = ttk.Button(
            footer,
            text="Confirmar - F5",
            style="Primary.TButton",
            command=self.on_confirm,
        )
        self.confirm_button.pack(side="left")

        self.cancel_button = ttk.Button(
            footer,
            text="Cancelar - ESC",
            style="Secondary.TButton",
            command=self.on_cancel,
        )
        self.cancel_button.pack(side="right")

    def _bind_shortcuts(self) -> None:
        self.root.bind("<F5>", self._on_confirm_event)
        self.root.bind("<Escape>", self._on_cancel_event)
        self.voucher_entry.bind("<Return>", self._on_confirm_event)

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
        interactive_state = "normal" if (self.integration_ready and not self.is_busy) else "disabled"
        self.confirm_button.configure(state=interactive_state)
        self.voucher_entry.configure(state=interactive_state)
        self.cancel_button.configure(state="normal")

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
        self.root.geometry("640x420")
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
        self.root.after(120, lambda: self._ensure_integration_ready(silent=True))

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
        self.status_var.set("Informe o voucher do app frota.")
        self.validated_voucher = None
        self.authorization_created = False

    def _ensure_integration_ready(self, silent: bool = False) -> None:
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
            response = self.api.validate_voucher(short_code)
            if not response.get("success"):
                raise RuntimeError(response.get("error") or "Voucher invalido.")
            return response

        self._run_async(worker, self._apply_validation)

    def _apply_validation(self, response: dict) -> None:
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
        self.status_var.set("Voucher validado. Pressione F5 para autorizar no caixa atual.")
        self.confirm_button.focus_force()

    def _build_rule_text(self, authorization: dict) -> str:
        scope = authorization.get("scope", "ALL_PRODUCTS")
        product_codes = authorization.get("productCodes") or []
        product_group_codes = authorization.get("productGroupCodes") or []
        customer_codes = authorization.get("customerCodes") or []
        customer_group_codes = authorization.get("customerGroupCodes") or []
        payment_form_codes = authorization.get("paymentFormCodes") or []

        if scope == "PRODUCT" and product_codes:
            base_rule = f"Produtos {', '.join(str(item) for item in product_codes)}"
        elif scope == "PRODUCT_GROUP" and product_group_codes:
            base_rule = f"Grupos de produto {', '.join(str(item) for item in product_group_codes)}"
        else:
            base_rule = "Todos os produtos"

        if customer_codes:
            customers = ", ".join(str(item) for item in customer_codes)
            base_rule = f"{base_rule} | Clientes {customers}"

        if customer_group_codes:
            customer_groups = ", ".join(str(item) for item in customer_group_codes)
            base_rule = f"{base_rule} | Grupos de cliente {customer_groups}"

        if payment_form_codes:
            payment_forms = ", ".join(str(item) for item in payment_form_codes)
            base_rule = f"{base_rule} | Formas de pagamento {payment_forms}"

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

        self.status_var.set("Registrando pre-autorizacao para o proximo abastecimento deste caixa...")
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
            f"Pre-autorizacao registrada. O proximo abastecimento deste caixa usara o voucher {item.get('shortCode', '')}."
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
        if self.hotkey_registered:
            ctypes.windll.user32.UnregisterHotKey(None, HOTKEY_ID)
        release_handle(self.show_event_handle)


def main() -> None:
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
    app = IntegracaoFrotaApp(root, show_event_handle=show_event_handle)

    def on_exit() -> None:
        app.shutdown()
        root.destroy()
        release_single_instance_mutex(mutex_handle)

    root.protocol("WM_DELETE_WINDOW", app.hide_window)
    root.bind("<Control-Shift-Q>", lambda _event: on_exit())
    root.mainloop()


if __name__ == "__main__":
    main()
