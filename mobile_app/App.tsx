import { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { API_ORIGIN } from "./src/config/api";
import { APP_NAME, BRAND_NAME, TENANT_ID } from "./src/config/brand";
import {
  fetchBootstrap,
  fetchEligiblePromotions,
  generatePromotionVoucher,
  loginCustomer,
  registerCustomer,
  updateMobileCustomerProfile,
} from "./src/services/mobileAuth";
import type {
  DocumentType,
  MobileCustomerAccount,
  MobileCustomerBootstrap,
  MobileCustomerPromotion,
  MobileCustomerPromotionVoucher,
  MobileCustomerSession,
  RegisterPayload,
} from "./src/types/mobileAuth";
import { maskBirthDate, maskDocument, maskPhone, normalizeEmail, validateEmail } from "./src/utils/format";

const SESSION_STORAGE_KEY = "datafrota-mobile-session";
const TOTAL_REGISTER_STEPS = 6;
const PROMOTION_REFRESH_INTERVAL_MS = 30000;

type AuthMode = "login" | "register";
type HomeTab = "home" | "promotions" | "profile";

type RegisterFormState = {
  documentType: DocumentType;
  documentNumber: string;
  fullName: string;
  phone: string;
  email: string;
  birthDate: string;
  password: string;
  confirmPassword: string;
};

const initialRegisterForm: RegisterFormState = {
  documentType: "cpf",
  documentNumber: "",
  fullName: "",
  phone: "",
  email: "",
  birthDate: "",
  password: "",
  confirmPassword: "",
};

function buildStepError(step: number, form: RegisterFormState): string | null {
  if (step === 0) {
    const minDigits = form.documentType === "cpf" ? 11 : 14;
    const digits = form.documentNumber.replace(/\D/g, "");
    if (digits.length !== minDigits) {
      return form.documentType === "cpf"
        ? "Informe um CPF valido com 11 digitos."
        : "Informe um CNPJ valido com 14 digitos.";
    }
  }

  if (step === 1 && form.fullName.trim().length < 3) {
    return "Informe o nome completo do cliente.";
  }

  if (step === 2) {
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      return "Informe um telefone ou WhatsApp valido.";
    }
  }

  if (step === 3 && !validateEmail(form.email)) {
    return "Informe um e-mail valido.";
  }

  if (step === 4) {
    const digits = form.birthDate.replace(/\D/g, "");
    if (digits.length !== 8) {
      return "Informe a data de nascimento no formato DD/MM/AAAA.";
    }

    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    const year = Number(digits.slice(4));
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(candidate.getTime()) ||
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() + 1 !== month ||
      candidate.getUTCDate() !== day
    ) {
      return "Informe uma data de nascimento valida.";
    }
  }

  if (step === 5) {
    if (form.password.trim().length < 4) {
      return "A senha deve ter no minimo 4 caracteres.";
    }

    if (form.password !== form.confirmPassword) {
      return "As senhas informadas nao conferem.";
    }
  }

  return null;
}

function getRegisterTitle(step: number): string {
  if (step === 5) {
    return "Agora vamos cadastrar uma senha para entrar no aplicativo.";
  }

  return "Preencha seus dados para participar das promocoes.";
}

function hasActiveMobileVoucher(item: MobileCustomerPromotion): boolean {
  if (item.voucherMode !== "mobile" || !item.voucherIssued || !item.validUntil) {
    return false;
  }

  const validUntil = new Date(item.validUntil).getTime();
  return Number.isFinite(validUntil) && validUntil > Date.now();
}

function formatVoucherValidUntil(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  try {
    const formatter = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    return `Codigo valido ate ${formatter.format(parsed)}.`;
  } catch {
    return `Codigo valido ate ${value}.`;
  }
}

function parsePromotionNumber(value: string | number | null | undefined): number {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return 0;
  }

  const normalized = rawValue.includes(",") ? rawValue.replace(/\./g, "").replace(",", ".") : rawValue;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPromotionNumber(value: number): string {
  const hasDecimals = Math.abs(value % 1) > 0.001;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPromotionCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function joinPromotionLabels(values: string[]): string {
  const items = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} e ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

function getPromotionDiscountLabel(item: MobileCustomerPromotion): string {
  const value = parsePromotionNumber(item.discountValue);
  if (item.discountType === "percent") {
    return `${formatPromotionNumber(value)}% OFF`;
  }

  return `${formatPromotionCurrency(value)} OFF`;
}

function getPromotionDiscountNarrative(item: MobileCustomerPromotion): string {
  const value = parsePromotionNumber(item.discountValue);
  if (item.discountType === "percent") {
    return `${formatPromotionNumber(value)}% de desconto`;
  }

  if (value > 0 && value < 1) {
    const cents = Math.round(value * 100);
    return `${formatPromotionNumber(cents)} centavos de desconto por unidade`;
  }

  return `${formatPromotionCurrency(value)} de desconto por unidade`;
}

function getPromotionProductNarrative(item: MobileCustomerPromotion): string {
  if (item.productMode === "group") {
    const groupNames = item.productGroupNames.length > 0 ? item.productGroupNames : item.productGroupCodes;
    const labels = joinPromotionLabels(groupNames);
    if (labels) {
      return groupNames.length === 1
        ? `na compra de produtos do grupo ${labels}`
        : `na compra de produtos dos grupos ${labels}`;
    }
  } else {
    const productNames = item.productNames.length > 0 ? item.productNames : item.productCodes;
    const labels = joinPromotionLabels(productNames);
    if (labels) {
      return productNames.length === 1 ? `na compra do produto ${labels}` : `na compra dos produtos ${labels}`;
    }
  }

  return "na compra dos produtos participantes";
}

function getPromotionDisplayDescription(item: MobileCustomerPromotion): string {
  const generatedSummary = `${getPromotionDiscountNarrative(item)} ${getPromotionProductNarrative(item)}.`.trim();
  const customDescription = item.description.trim();

  if (!customDescription) {
    return generatedSummary;
  }

  return customDescription;
}

function getPromotionTimeRule(item: MobileCustomerPromotion): string | null {
  const startTime = String(item.startTime ?? "").trim().slice(0, 5);
  const endTime = String(item.endTime ?? "").trim().slice(0, 5);

  if (!startTime || !endTime) {
    return null;
  }

  return `Horario: ${startTime} as ${endTime}`;
}

function getPromotionAudienceLabel(item: MobileCustomerPromotion): string {
  if (item.eligibilityKind === "individual") {
    return "Disponivel para o seu cadastro";
  }

  if (item.eligibilityKind === "group") {
    return "Disponivel para o seu grupo";
  }

  return "Disponivel para todos os clientes";
}

function getPromotionVoucherSectionLabel(item: MobileCustomerPromotion): string {
  return item.voucherMode === "fixed" ? "Voucher da campanha" : "Voucher do seu app";
}

function getPromotionVoucherStatusLabel(item: MobileCustomerPromotion): string {
  if (item.voucherMode === "fixed") {
    return "Codigo compartilhado";
  }

  return item.voucherIssued ? "Voucher pronto" : "Aguardando emissao";
}

function getPromotionVoucherHint(item: MobileCustomerPromotion): string {
  if (item.voucherMode === "fixed") {
    return "O mesmo codigo e valido para todos os clientes elegiveis desta campanha.";
  }

  if (item.voucherIssued) {
    return "Apresente este codigo no caixa para validar a promocao vinculada ao seu cadastro.";
  }

  return "Gere o voucher quando estiver no posto. Cada emissao libera um codigo valido por 15 minutos.";
}

function getPromotionVoucherValidityLabel(item: MobileCustomerPromotion): string | null {
  if (item.voucherMode !== "mobile" || !item.voucherIssued) {
    return null;
  }

  return formatVoucherValidUntil(item.validUntil);
}

function formatBirthDateForInput(value?: string | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const [year, month, day] = raw.split("-", 3);
  if (!year || !month || !day) {
    return "";
  }

  return `${day}/${month}/${year}`;
}

function App() {
  const scrollViewRef = useRef<ScrollView | null>(null);
  const focusedInputGroupRef = useRef<"login" | "register">("register");
  const focusedRegisterStepRef = useRef(0);
  const [mode, setMode] = useState<AuthMode>("register");
  const [registerStep, setRegisterStep] = useState(0);
  const [registerForm, setRegisterForm] = useState<RegisterFormState>(initialRegisterForm);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [bootstrap, setBootstrap] = useState<MobileCustomerBootstrap | null>(null);
  const [session, setSession] = useState<MobileCustomerSession | null>(null);
  const [promotions, setPromotions] = useState<MobileCustomerPromotion[]>([]);
  const [promotionsLoading, setPromotionsLoading] = useState(false);
  const [promotionsError, setPromotionsError] = useState<string | null>(null);
  const [issuingPromotionId, setIssuingPromotionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<HomeTab>("home");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    birthDate: "",
  });

  useEffect(() => {
    async function prepareApp() {
      try {
        const [savedSession, bootstrapConfig] = await Promise.all([
          AsyncStorage.getItem(SESSION_STORAGE_KEY),
          fetchBootstrap(TENANT_ID),
        ]);

        if (savedSession) {
          const parsed = JSON.parse(savedSession) as MobileCustomerSession;
          if (new Date(parsed.expiresAt).getTime() > Date.now()) {
            setSession(parsed);
          } else {
            await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
          }
        }

        setBootstrap(bootstrapConfig);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Nao foi possivel iniciar o app mobile.");
      } finally {
        setLoading(false);
      }
    }

    void prepareApp();
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
      setTimeout(() => {
        scrollToFocusedField(focusedInputGroupRef.current, focusedRegisterStepRef.current);
      }, 80);
    });

    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const companyName = bootstrap?.defaultCompanyName || BRAND_NAME;
  const companyId = bootstrap?.defaultCompanyId || TENANT_ID;

  const loginSubtitle = useMemo(() => {
    if (!bootstrap) {
      return `Conectando ao ambiente mobile de ${BRAND_NAME}.`;
    }

    return `Acesso do cliente conectado em ${companyName}.`;
  }, [bootstrap, companyName]);

  const firstName = session?.customer.fullName.trim().split(/\s+/)[0] || "Cliente";
  const customerPoints = 0;
  const androidTopInset = Platform.OS === "android" ? (NativeStatusBar.currentHeight ?? 0) : 0;

  useEffect(() => {
    if (!session) {
      setProfileForm({
        fullName: "",
        phone: "",
        email: "",
        birthDate: "",
      });
      setProfileError(null);
      setProfileSuccess(null);
      return;
    }

    setProfileForm({
      fullName: session.customer.fullName,
      phone: session.customer.phone,
      email: session.customer.email,
      birthDate: formatBirthDateForInput(session.customer.birthDate),
    });
  }, [session?.customer.fullName, session?.customer.phone, session?.customer.email, session?.customer.birthDate, Boolean(session)]);

  function scrollToFocusedField(inputGroup: "login" | "register", step = registerStep) {
    requestAnimationFrame(() => {
      const isAndroid = Platform.OS === "android";
      const baseOffset =
        inputGroup === "login"
          ? isAndroid
            ? step === 1
              ? 210
              : 168
            : 300
          : isAndroid
            ? step === 0
              ? 164
              : step === 5
                ? 176
              : 128
            : 350;
      const stepOffset = inputGroup === "login" ? 0 : step * (isAndroid ? 20 : 24);
      scrollViewRef.current?.scrollTo({
        y: baseOffset + stepOffset,
        animated: true,
      });
    });
  }

  function handleFieldFocus(inputGroup: "login" | "register", step = registerStep) {
    focusedInputGroupRef.current = inputGroup;
    focusedRegisterStepRef.current = step;
    scrollToFocusedField(inputGroup, step);
  }

  async function persistSession(nextSession: MobileCustomerSession) {
    setSession(nextSession);
    setActiveTab("home");
    await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
  }

  async function persistUpdatedCustomer(nextCustomer: MobileCustomerAccount) {
    setSession((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        customer: nextCustomer,
      };
    });

    if (!session) {
      return;
    }

    await AsyncStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        ...session,
        customer: nextCustomer,
      }),
    );
  }

  useEffect(() => {
    if (!session?.accessToken) {
      setPromotions([]);
      setPromotionsError(null);
      setPromotionsLoading(false);
      return;
    }

    const accessToken = session.accessToken;
    let cancelled = false;

    async function loadPromotions(showLoader: boolean) {
      if (showLoader) {
        setPromotionsLoading(true);
      }

      try {
        const items = await fetchEligiblePromotions(accessToken);
        if (cancelled) {
          return;
        }

        setPromotions((current) => {
          const existingMap = new Map(current.map((promotion) => [promotion.id, promotion]));
          return items.map((item) => {
            const existing = existingMap.get(item.id);
            if (!existing) {
              return item;
            }

            if (hasActiveMobileVoucher(existing) && !hasActiveMobileVoucher(item)) {
              return {
                ...item,
                voucherCode: existing.voucherCode,
                voucherIssued: existing.voucherIssued,
                validUntil: existing.validUntil,
              };
            }

            return item;
          });
        });
        setPromotionsError(null);
      } catch (nextError) {
        if (cancelled) {
          return;
        }

        setPromotionsError(
          nextError instanceof Error ? nextError.message : "Nao foi possivel carregar as promocoes do app.",
        );
      } finally {
        if (!cancelled) {
          setPromotionsLoading(false);
        }
      }
    }

    void loadPromotions(true);
    const intervalId = setInterval(() => {
      void loadPromotions(false);
    }, PROMOTION_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [session?.accessToken]);

  async function handleRegisterAdvance() {
    const issue = buildStepError(registerStep, registerForm);
    if (issue) {
      setError(issue);
      return;
    }

    setError(null);

    if (registerStep < TOTAL_REGISTER_STEPS - 1) {
      Keyboard.dismiss();
      setRegisterStep((current) => current + 1);
      return;
    }

    setSubmitting(true);

    try {
      const payload: RegisterPayload = {
        companyId,
        documentType: registerForm.documentType,
        documentNumber: registerForm.documentNumber,
        fullName: registerForm.fullName.trim(),
        phone: registerForm.phone,
        email: normalizeEmail(registerForm.email),
        birthDate: registerForm.birthDate,
        password: registerForm.password,
      };
      const nextSession = await registerCustomer(payload);
      await persistSession(nextSession);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Nao foi possivel concluir o cadastro.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogin() {
    if (!loginIdentifier.trim()) {
      setError("Informe o documento ou e-mail.");
      return;
    }

    if (!loginPassword) {
      setError("Informe a senha.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const nextSession = await loginCustomer({
        companyId,
        identifier: normalizeEmail(loginIdentifier),
        password: loginPassword,
      });
      await persistSession(nextSession);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Nao foi possivel autenticar.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    setSession(null);
    setPromotions([]);
    setPromotionsError(null);
    setActiveTab("home");
    await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
  }

  async function handleGeneratePromotionVoucher(item: MobileCustomerPromotion) {
    if (!session?.accessToken || issuingPromotionId) {
      return;
    }

    setIssuingPromotionId(item.id);
    setPromotionsError(null);

    try {
      const issuedVoucher: MobileCustomerPromotionVoucher = await generatePromotionVoucher(session.accessToken, item.id);
      setPromotions((current) =>
        current.map((promotion) =>
          promotion.id === item.id
            ? {
                ...promotion,
                voucherCode: issuedVoucher.voucherCode,
                voucherIssued: true,
                validUntil: issuedVoucher.validUntil,
              }
            : promotion,
        ),
      );
    } catch (nextError) {
      setPromotionsError(nextError instanceof Error ? nextError.message : "Nao foi possivel gerar o voucher no app.");
    } finally {
      setIssuingPromotionId(null);
    }
  }

  function updateRegisterField<Key extends keyof RegisterFormState>(key: Key, value: RegisterFormState[Key]) {
    setRegisterForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function renderRegisterField() {
    if (registerStep === 0) {
      return (
        <>
          <Text style={styles.label}>Documento *</Text>
          <View style={styles.segmentedControl}>
            <Pressable
              style={[
                styles.segmentButton,
                registerForm.documentType === "cpf" && styles.segmentButtonActive,
              ]}
              onPress={() => updateRegisterField("documentType", "cpf")}
            >
              <Text
                style={[
                  styles.segmentButtonText,
                  registerForm.documentType === "cpf" && styles.segmentButtonTextActive,
                ]}
              >
                CPF
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.segmentButton,
                registerForm.documentType === "cnpj" && styles.segmentButtonActive,
              ]}
              onPress={() => updateRegisterField("documentType", "cnpj")}
            >
              <Text
                style={[
                  styles.segmentButtonText,
                  registerForm.documentType === "cnpj" && styles.segmentButtonTextActive,
                ]}
              >
                CNPJ
              </Text>
            </Pressable>
          </View>
          <TextInput
            value={registerForm.documentNumber}
            onChangeText={(value) => updateRegisterField("documentNumber", maskDocument(value, registerForm.documentType))}
            onFocus={() => handleFieldFocus("register", 0)}
            placeholder={registerForm.documentType === "cpf" ? "000.000.000-00" : "00.000.000/0000-00"}
            keyboardType="number-pad"
            placeholderTextColor="#94a3b8"
            style={styles.input}
          />
        </>
      );
    }

    if (registerStep === 1) {
      return (
        <>
          <Text style={styles.label}>Nome completo *</Text>
          <TextInput
            value={registerForm.fullName}
            onChangeText={(value) => updateRegisterField("fullName", value)}
            onFocus={() => handleFieldFocus("register", 1)}
            placeholder="Seu nome completo"
            placeholderTextColor="#94a3b8"
            style={styles.input}
          />
        </>
      );
    }

    if (registerStep === 2) {
      return (
        <>
          <Text style={styles.label}>Telefone / WhatsApp *</Text>
          <TextInput
            value={registerForm.phone}
            onChangeText={(value) => updateRegisterField("phone", maskPhone(value))}
            onFocus={() => handleFieldFocus("register", 2)}
            placeholder="(00) 00000-0000"
            keyboardType="phone-pad"
            placeholderTextColor="#94a3b8"
            style={styles.input}
          />
        </>
      );
    }

    if (registerStep === 3) {
      return (
        <>
          <Text style={styles.label}>E-mail *</Text>
          <TextInput
            value={registerForm.email}
            onChangeText={(value) => updateRegisterField("email", value)}
            onFocus={() => handleFieldFocus("register", 3)}
            placeholder="voce@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            placeholderTextColor="#94a3b8"
            style={styles.input}
          />
        </>
      );
    }

    if (registerStep === 4) {
      return (
        <>
          <Text style={styles.label}>Data de nascimento *</Text>
          <TextInput
            value={registerForm.birthDate}
            onChangeText={(value) => updateRegisterField("birthDate", maskBirthDate(value))}
            onFocus={() => handleFieldFocus("register", 4)}
            placeholder="DD/MM/AAAA"
            keyboardType="number-pad"
            placeholderTextColor="#94a3b8"
            style={styles.input}
          />
          <Text style={styles.helperText}>Necessario para campanhas especiais de aniversario.</Text>
        </>
      );
    }

    return (
      <>
        <Text style={styles.helperText}>Senha * (minimo 4 caracteres)</Text>
        <View style={styles.inputWithAction}>
          <TextInput
            value={registerForm.password}
            onChangeText={(value) => updateRegisterField("password", value)}
            onFocus={() => handleFieldFocus("register", 5)}
            placeholder="Sua senha"
            placeholderTextColor="#94a3b8"
            secureTextEntry={!showRegisterPassword}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            style={styles.inputFieldWithAction}
          />
          <Pressable
            style={styles.inputActionButton}
            onPress={() => setShowRegisterPassword((current) => !current)}
            hitSlop={8}
          >
            <Ionicons
              name={showRegisterPassword ? "eye-off-outline" : "eye-outline"}
              size={20}
              color="#64748b"
            />
          </Pressable>
        </View>
        <Text style={[styles.label, styles.secondaryLabel]}>Confirme a senha *</Text>
        <View style={styles.inputWithAction}>
          <TextInput
            value={registerForm.confirmPassword}
            onChangeText={(value) => updateRegisterField("confirmPassword", value)}
            onFocus={() => handleFieldFocus("register", 5)}
            placeholder="Digite a senha novamente"
            placeholderTextColor="#94a3b8"
            secureTextEntry={!showRegisterConfirmPassword}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            style={styles.inputFieldWithAction}
          />
          <Pressable
            style={styles.inputActionButton}
            onPress={() => setShowRegisterConfirmPassword((current) => !current)}
            hitSlop={8}
          >
            <Ionicons
              name={showRegisterConfirmPassword ? "eye-off-outline" : "eye-outline"}
              size={20}
              color="#64748b"
            />
          </Pressable>
        </View>
      </>
    );
  }

  function renderAuthCard() {
    if (session) {
      return null;
    }

    if (mode === "login") {
      return (
        <View style={styles.card}>
          <Text style={styles.panelTitle}>Entrar</Text>
          <Text style={styles.panelSubtitle}>{loginSubtitle}</Text>
          <Text style={styles.label}>Documento ou e-mail *</Text>
          <TextInput
            value={loginIdentifier}
            onChangeText={setLoginIdentifier}
            onFocus={() => handleFieldFocus("login")}
            placeholder="CPF, CNPJ ou e-mail"
            placeholderTextColor="#94a3b8"
            style={styles.input}
            autoCapitalize="none"
          />
          <Text style={styles.label}>Senha *</Text>
          <TextInput
            value={loginPassword}
            onChangeText={setLoginPassword}
            onFocus={() => handleFieldFocus("login", 1)}
            placeholder="Sua senha"
            placeholderTextColor="#94a3b8"
            style={styles.input}
            secureTextEntry
          />
          <Pressable style={[styles.primaryButton, submitting && styles.buttonDisabled]} onPress={() => void handleLogin()}>
            {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Entrar</Text>}
          </Pressable>
          <Pressable onPress={() => {
            Keyboard.dismiss();
            setMode("register");
            setError(null);
          }}>
            <Text style={styles.footerLink}>Ainda nao tem cadastro? Criar cadastro</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.card}>
        <View style={styles.progressRow}>
          {Array.from({ length: TOTAL_REGISTER_STEPS }).map((_, index) => (
            <View
              key={index}
              style={[
                styles.progressSegment,
                index <= registerStep && styles.progressSegmentActive,
              ]}
            />
          ))}
        </View>
        <Text style={styles.panelTitle}>Criar cadastro</Text>
        <Text style={styles.panelSubtitle}>{getRegisterTitle(registerStep)}</Text>
        {renderRegisterField()}
        {registerStep === 0 ? (
          <View style={styles.actionsRowSingle}>
            <Pressable
              style={[styles.primaryButton, styles.primaryButtonFull, submitting && styles.buttonDisabled]}
              onPress={() => void handleRegisterAdvance()}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <View style={styles.buttonContent}>
                  <Text style={styles.primaryButtonText}>Continuar</Text>
                  <Ionicons name="arrow-forward" size={18} color="#ffffff" />
                </View>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={styles.actionsRow}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                Keyboard.dismiss();
                setRegisterStep((current) => Math.max(0, current - 1));
                setError(null);
              }}
            >
              <Ionicons name="arrow-back" size={20} color="#475569" />
            </Pressable>
            <Pressable
              style={[styles.primaryButton, styles.primaryButtonWide, submitting && styles.buttonDisabled]}
              onPress={() => void handleRegisterAdvance()}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <View style={styles.buttonContent}>
                  <Text style={styles.primaryButtonText}>
                    {registerStep === TOTAL_REGISTER_STEPS - 1 ? "Entrar" : "Continuar"}
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color="#ffffff" />
                </View>
              )}
            </Pressable>
          </View>
        )}
        <Pressable onPress={() => {
          Keyboard.dismiss();
          setMode("login");
          setError(null);
        }}>
          <Text style={styles.footerLink}>Ja tem cadastro? Entrar</Text>
        </Pressable>
      </View>
    );
  }

  function renderHomeTab() {
    return (
      <View style={styles.interiorSection}>
        <Text style={styles.greetingEyebrow}>Boa tarde,</Text>
        <Text style={styles.greetingName}>{firstName} 👋</Text>

        <View style={styles.pointsCard}>
          <View style={styles.pointsGlowPrimary} />
          <View style={styles.pointsGlowSecondary} />
          <View style={styles.pointsHeader}>
            <View style={styles.pointsLabelRow}>
              <View style={styles.pointsIconBubble}>
                <Ionicons name="sparkles-outline" size={16} color="#ede9fe" />
              </View>
              <Text style={styles.pointsLabel}>SEUS PONTOS</Text>
            </View>
            <Ionicons name="sparkles" size={18} color="rgba(255,255,255,0.88)" />
          </View>

          <View style={styles.pointsValueRow}>
            <Text style={styles.pointsValue}>{customerPoints}</Text>
            <Text style={styles.pointsUnit}>pts</Text>
          </View>

          <View style={styles.pointsHintPill}>
            <Ionicons name="card-outline" size={15} color="#f5f3ff" />
            <Text style={styles.pointsHintText}>Acumule pontos a cada abastecimento</Text>
          </View>
        </View>

        <Text style={styles.shortcutsTitle}>ATALHOS</Text>

        <Pressable style={styles.shortcutCard} onPress={() => setActiveTab("promotions")}>
          <View style={[styles.shortcutIconWrap, styles.shortcutIconPrimary]}>
            <Ionicons name="megaphone-outline" size={20} color="#ffffff" />
          </View>
          <View style={styles.shortcutBody}>
            <Text style={styles.shortcutHeading}>Promocoes disponiveis</Text>
            <Text style={styles.shortcutDescription}>
              {promotionsLoading
                ? "Atualizando suas campanhas elegiveis..."
                : promotions.length > 0
                  ? `${promotions.length} campanha(s) elegivel(is) para o seu cadastro`
                  : "Nenhuma campanha elegivel neste momento"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#cbd5e1" />
        </Pressable>

        <Pressable style={styles.shortcutCard} onPress={() => setActiveTab("promotions")}>
          <View style={[styles.shortcutIconWrap, styles.shortcutIconWarning]}>
            <Ionicons name="gift-outline" size={20} color="#ffffff" />
          </View>
          <View style={styles.shortcutBody}>
            <Text style={styles.shortcutHeading}>Resgatar recompensas</Text>
            <Text style={styles.shortcutDescription}>Em breve</Text>
          </View>
          <View style={styles.badgeSoon}>
            <Text style={styles.badgeSoonText}>EM BREVE</Text>
          </View>
        </Pressable>
      </View>
    );
  }

  function renderPromotionsTab() {
    const hasPromotions = promotions.length > 0;

    return (
      <View style={styles.interiorSection}>
        <Text style={styles.sectionScreenTitle}>Promocoes</Text>
        <Text style={styles.sectionScreenSubtitle}>
          Promocoes validas para seu perfil
        </Text>

        {promotionsLoading ? (
          <View style={styles.infoCard}>
            <ActivityIndicator color="#6d28d9" />
            <Text style={styles.infoCardTitle}>Atualizando campanhas</Text>
            <Text style={styles.infoCardText}>Consultando as promocoes elegiveis para o seu cadastro.</Text>
          </View>
        ) : null}

        {promotionsError ? (
          <View style={styles.infoCard}>
            <View style={[styles.shortcutIconWrap, styles.shortcutIconWarning]}>
              <Ionicons name="alert-circle-outline" size={20} color="#ffffff" />
            </View>
            <Text style={styles.infoCardTitle}>Falha ao carregar promocoes</Text>
            <Text style={styles.infoCardText}>{promotionsError}</Text>
          </View>
        ) : null}

        {!promotionsLoading && !hasPromotions && !promotionsError ? (
          <View style={styles.infoCard}>
            <View style={[styles.shortcutIconWrap, styles.shortcutIconPrimary]}>
              <Ionicons name="pricetags-outline" size={20} color="#ffffff" />
            </View>
            <Text style={styles.infoCardTitle}>Nenhuma campanha elegivel</Text>
            <Text style={styles.infoCardText}>
              Quando houver promocao para o seu cadastro, grupo de cliente ou publico geral, ela aparecera aqui.
            </Text>
          </View>
        ) : null}

        {promotions.map((item) => (
          <View key={item.id} style={styles.promotionCard}>
            <View style={styles.promotionCardHeader}>
              <View style={styles.promotionBadgePrimary}>
                <Text style={styles.promotionBadgePrimaryText}>{getPromotionDiscountLabel(item)}</Text>
              </View>
              <View style={styles.promotionBadgeSecondary}>
                <Text style={styles.promotionBadgeSecondaryText}>{getPromotionAudienceLabel(item)}</Text>
              </View>
            </View>

            <Text style={styles.promotionTitle}>{item.name}</Text>
            <Text style={styles.promotionDescription}>{getPromotionDisplayDescription(item)}</Text>

            <View style={[styles.promotionVoucherPanel, item.voucherIssued && styles.promotionVoucherPanelIssued]}>
              <View style={styles.promotionVoucherTopRow}>
                <View style={styles.promotionVoucherIdentity}>
                  <View style={[styles.promotionVoucherIconWrap, item.voucherIssued && styles.promotionVoucherIconWrapIssued]}>
                    <Ionicons
                      name={item.voucherIssued ? "ticket-outline" : "flash-outline"}
                      size={18}
                      color={item.voucherIssued ? "#6d28d9" : "#7c3aed"}
                    />
                  </View>
                  <View style={styles.promotionVoucherIdentityText}>
                    <Text style={styles.promotionVoucherLabel}>{getPromotionVoucherSectionLabel(item)}</Text>
                    <Text style={styles.promotionVoucherStatus}>{getPromotionVoucherStatusLabel(item)}</Text>
                  </View>
                </View>
                <View style={[styles.promotionVoucherStateBadge, item.voucherIssued && styles.promotionVoucherStateBadgeIssued]}>
                  <Text style={[styles.promotionVoucherStateBadgeText, item.voucherIssued && styles.promotionVoucherStateBadgeTextIssued]}>
                    {item.voucherIssued ? "Ativo" : "Pendente"}
                  </Text>
                </View>
              </View>

              <Text style={[styles.promotionVoucherCode, !item.voucherIssued && styles.promotionVoucherCodePending]}>
                {item.voucherIssued ? item.voucherCode : "Ainda nao gerado"}
              </Text>
              {getPromotionVoucherValidityLabel(item) ? (
                <View style={styles.promotionVoucherValidityRow}>
                  <Ionicons name="time-outline" size={15} color="#7c3aed" />
                  <Text style={styles.promotionVoucherValidityText}>{getPromotionVoucherValidityLabel(item)}</Text>
                </View>
              ) : null}
              <Text style={styles.promotionVoucherHint}>{getPromotionVoucherHint(item)}</Text>
            </View>

            <View style={styles.promotionInfoGrid}>
              {getPromotionTimeRule(item) ? (
                <View style={styles.promotionInfoChip}>
                  <Ionicons name="time-outline" size={15} color="#7c3aed" />
                  <Text style={styles.promotionInfoChipText}>{getPromotionTimeRule(item)?.replace("Horario: ", "")}</Text>
                </View>
              ) : null}
              {item.requireCustomerDocumentAtCashier ? (
                <View style={styles.promotionInfoChip}>
                  <Ionicons name="card-outline" size={15} color="#7c3aed" />
                  <Text style={styles.promotionInfoChipText}>Confirma CPF/CNPJ</Text>
                </View>
              ) : null}
            </View>

            {item.voucherMode === "fixed" ? (
              <View style={styles.promotionMetaList}>
                <Text style={styles.promotionMetaText}>Campanha com codigo fixo compartilhado para todos os clientes elegiveis.</Text>
              </View>
            ) : null}

            {item.voucherMode === "mobile" ? (
              <Pressable
                style={[
                  styles.promotionVoucherButton,
                  item.voucherIssued && styles.promotionVoucherButtonIssued,
                  issuingPromotionId === item.id && styles.buttonDisabled,
                ]}
                onPress={() => void handleGeneratePromotionVoucher(item)}
                disabled={issuingPromotionId !== null}
              >
                {issuingPromotionId === item.id ? (
                  <ActivityIndicator color={item.voucherIssued ? "#6d28d9" : "#ffffff"} />
                ) : (
                  <>
                    <Ionicons
                      name={item.voucherIssued ? "refresh-outline" : "flash-outline"}
                      size={18}
                      color={item.voucherIssued ? "#6d28d9" : "#ffffff"}
                    />
                    <Text style={[styles.promotionVoucherButtonText, item.voucherIssued && styles.promotionVoucherButtonTextIssued]}>
                      {item.voucherIssued ? "Gerar novo voucher" : "Gerar voucher"}
                    </Text>
                  </>
                )}
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    );
  }

  function renderProfileTab() {
    if (!session) {
      return null;
    }

    async function handleSaveProfile() {
      if (!session?.accessToken || profileSaving) {
        return;
      }

      const normalizedEmail = normalizeEmail(profileForm.email);
      if (!profileForm.fullName.trim()) {
        setProfileError("Informe o nome completo do cliente.");
        setProfileSuccess(null);
        return;
      }

      if (!validateEmail(normalizedEmail)) {
        setProfileError("Informe um e-mail valido.");
        setProfileSuccess(null);
        return;
      }

      const phoneDigits = profileForm.phone.replace(/\D/g, "");
      if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        setProfileError("Informe um telefone ou WhatsApp valido.");
        setProfileSuccess(null);
        return;
      }

      const birthDigits = profileForm.birthDate.replace(/\D/g, "");
      if (birthDigits.length !== 8) {
        setProfileError("Informe a data de nascimento no formato DD/MM/AAAA.");
        setProfileSuccess(null);
        return;
      }

      setProfileSaving(true);
      setProfileError(null);
      setProfileSuccess(null);

      try {
        const updated = await updateMobileCustomerProfile(session.accessToken, {
          fullName: profileForm.fullName.trim(),
          phone: profileForm.phone,
          email: normalizedEmail,
          birthDate: profileForm.birthDate,
        });
        await persistUpdatedCustomer(updated);
        setProfileSuccess("Perfil atualizado com sucesso.");
      } catch (nextError) {
        setProfileError(nextError instanceof Error ? nextError.message : "Nao foi possivel atualizar o perfil.");
      } finally {
        setProfileSaving(false);
      }
    }

    return (
      <View style={styles.interiorSection}>
        <Text style={styles.sectionScreenTitle}>Perfil</Text>
        <Text style={styles.sectionScreenSubtitle}>Dados sincronizados com o cadastro web do cliente.</Text>

        <View style={styles.profileCard}>
          <View style={styles.profileHeader}>
            <View style={styles.profileAvatar}>
              <Text style={styles.profileAvatarText}>{firstName.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.profileHeaderText}>
              <Text style={styles.profileName}>{session.customer.fullName}</Text>
              <Text style={styles.profileCompany}>{session.customer.companyName}</Text>
            </View>
          </View>

          <View style={styles.profileDetails}>
            <Text style={styles.profileLabel}>Documento</Text>
            <Text style={styles.profileValue}>{session.customer.documentNumber}</Text>
            <Text style={styles.profileLabel}>Nome completo</Text>
            <TextInput
              value={profileForm.fullName}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, fullName: value }))}
              placeholder="Seu nome completo"
              placeholderTextColor="#94a3b8"
              style={styles.profileInput}
            />
            <Text style={styles.profileLabel}>E-mail</Text>
            <TextInput
              value={profileForm.email}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, email: value }))}
              placeholder="voce@email.com"
              placeholderTextColor="#94a3b8"
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.profileInput}
            />
            <Text style={styles.profileLabel}>Telefone</Text>
            <TextInput
              value={profileForm.phone}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, phone: maskPhone(value) }))}
              placeholder="(00) 00000-0000"
              placeholderTextColor="#94a3b8"
              keyboardType="phone-pad"
              style={styles.profileInput}
            />
            <Text style={styles.profileLabel}>Data de nascimento</Text>
            <TextInput
              value={profileForm.birthDate}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, birthDate: maskBirthDate(value) }))}
              placeholder="DD/MM/AAAA"
              placeholderTextColor="#94a3b8"
              keyboardType="number-pad"
              style={styles.profileInput}
            />
          </View>

          {profileError ? <Text style={styles.profileErrorText}>{profileError}</Text> : null}
          {profileSuccess ? <Text style={styles.profileSuccessText}>{profileSuccess}</Text> : null}

          <Pressable
            style={[styles.profileSaveButton, profileSaving && styles.buttonDisabled]}
            onPress={() => void handleSaveProfile()}
            disabled={profileSaving}
          >
            {profileSaving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <View style={styles.buttonContent}>
                <Ionicons name="save-outline" size={18} color="#ffffff" />
                <Text style={styles.primaryButtonText}>Salvar</Text>
              </View>
            )}
          </Pressable>

          <Pressable style={styles.profileLogoutButton} onPress={() => void handleLogout()}>
            <Ionicons name="log-out-outline" size={18} color="#ffffff" />
            <Text style={styles.primaryButtonText}>Sair da conta</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderAuthenticatedContent() {
    if (activeTab === "promotions") {
      return renderPromotionsTab();
    }

    if (activeTab === "profile") {
      return renderProfileTab();
    }

    return renderHomeTab();
  }

  function renderAuthenticatedScreen() {
    return (
      <ImageBackground source={require("./assets/branding/fundo.jpg")} style={styles.background} resizeMode="cover">
        <ExpoStatusBar style="dark" />
        <View style={styles.overlayAuthenticated} />
        <SafeAreaView style={styles.safeArea}>
          <View style={[styles.shellTopBar, { paddingTop: 8 + androidTopInset }]}>
            <View style={styles.shellBrandBlock}>
              <View style={styles.shellBrandIcon}>
                <Ionicons name="wallet-outline" size={18} color="#ffffff" />
              </View>
              <View>
                <Text style={styles.shellBrandName}>{companyName}</Text>
                <Text style={styles.shellBrandSubtitle}>Ola, {firstName}!</Text>
              </View>
            </View>

            <Pressable style={styles.shellTopAction} onPress={() => setActiveTab("profile")}>
              <Ionicons name="person-circle-outline" size={22} color="#64748b" />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.interiorScrollContent} showsVerticalScrollIndicator={false}>
            {renderAuthenticatedContent()}
          </ScrollView>

          <View style={styles.bottomTabBar}>
            {[
              { key: "home" as const, label: "Inicio", icon: "home-outline", activeIcon: "home" },
              { key: "promotions" as const, label: "Promocoes", icon: "megaphone-outline", activeIcon: "megaphone" },
              { key: "profile" as const, label: "Perfil", icon: "person-outline", activeIcon: "person" },
            ].map((item) => {
              const isActive = activeTab === item.key;
              return (
                <Pressable key={item.key} style={styles.tabItem} onPress={() => setActiveTab(item.key)}>
                  <Ionicons
                    name={(isActive ? item.activeIcon : item.icon) as keyof typeof Ionicons.glyphMap}
                    size={22}
                    color={isActive ? "#6d28d9" : "#94a3b8"}
                  />
                  <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </SafeAreaView>
      </ImageBackground>
    );
  }

  if (session) {
    return renderAuthenticatedScreen();
  }

  return (
    <ImageBackground source={require("./assets/branding/fundo.jpg")} style={styles.background} resizeMode="cover">
      <ExpoStatusBar style="light" />
      <View style={styles.overlay} />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 20 : 0}
          style={styles.flex}
        >
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={[
              styles.scrollContent,
              keyboardVisible && styles.scrollContentKeyboard,
              keyboardVisible && mode === "login" && styles.scrollContentKeyboardLogin,
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              <Image source={require("./assets/branding/logo_databrev_transparent.png")} style={styles.logo} />
              <Text style={styles.heroTitle}>
                {session ? "Conta ativa" : mode === "login" ? "Entrar" : "Criar cadastro"}
              </Text>
              <Text style={styles.heroSubtitle}>
                {session
                  ? "Seu acesso mobile ja esta pronto para consumir a plataforma."
                  : "Preencha seus dados para participar das promocoes."}
              </Text>
              <Text style={styles.brandTitle}>{APP_NAME}</Text>
              <Text style={styles.environmentBadge}>
                {loading ? "Carregando ambiente local..." : `${companyName} | tenant ${companyId}`}
              </Text>
            </View>

            {loading ? (
              <View style={styles.loadingCard}>
                <ActivityIndicator size="large" color="#7c3aed" />
                <Text style={styles.loadingText}>Preparando conexao com a API local...</Text>
                <Text style={styles.loadingMetaText}>API local: {API_ORIGIN}</Text>
                <Text style={styles.loadingMetaText}>Tenant: {TENANT_ID}</Text>
              </View>
            ) : (
              renderAuthCard()
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  background: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.36)",
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 40,
    gap: 18,
  },
  scrollContentKeyboard: {
    paddingBottom: 168,
  },
  scrollContentKeyboardLogin: {
    paddingBottom: 232,
  },
  hero: {
    alignItems: "center",
    gap: 8,
  },
  logo: {
    width: 74,
    height: 74,
    resizeMode: "contain",
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 36,
    fontWeight: "800",
    textAlign: "center",
  },
  heroSubtitle: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 320,
  },
  environmentBadge: {
    marginTop: 4,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.18)",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  brandTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    opacity: 0.92,
  },
  card: {
    borderRadius: 28,
    backgroundColor: "rgba(248, 250, 252, 0.92)",
    paddingHorizontal: 24,
    paddingVertical: 22,
    shadowColor: "#020617",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
    gap: 12,
  },
  progressRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
  },
  progressSegment: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: "#e2e8f0",
  },
  progressSegmentActive: {
    backgroundColor: "#6d28d9",
  },
  panelTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
  },
  panelSubtitle: {
    textAlign: "center",
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  label: {
    color: "#1f2937",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryLabel: {
    marginTop: 4,
  },
  helperText: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  segmentedControl: {
    alignSelf: "flex-end",
    flexDirection: "row",
    gap: 8,
    marginTop: -4,
    marginBottom: 6,
  },
  segmentButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#ede9fe",
  },
  segmentButtonActive: {
    backgroundColor: "#6d28d9",
  },
  segmentButtonText: {
    color: "#5b21b6",
    fontSize: 13,
    fontWeight: "700",
  },
  segmentButtonTextActive: {
    color: "#ffffff",
  },
  input: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#0f172a",
  },
  inputWithAction: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 10,
  },
  inputFieldWithAction: {
    flex: 1,
    minHeight: 54,
    fontSize: 16,
    color: "#0f172a",
    paddingRight: 10,
  },
  inputActionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
    width: "100%",
  },
  actionsRowSingle: {
    marginTop: 6,
    width: "100%",
  },
  secondaryButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: "#6d28d9",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryButtonWide: {
    flex: 1,
  },
  primaryButtonFull: {
    width: "100%",
    flex: 0,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  footerLink: {
    marginTop: 8,
    textAlign: "center",
    color: "#6d28d9",
    fontSize: 15,
    fontWeight: "700",
  },
  loadingCard: {
    borderRadius: 28,
    backgroundColor: "rgba(248, 250, 252, 0.92)",
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: "#334155",
    fontSize: 15,
    textAlign: "center",
  },
  loadingMetaText: {
    color: "#64748b",
    fontSize: 12,
    textAlign: "center",
  },
  errorText: {
    textAlign: "center",
    color: "#ffffff",
    fontSize: 14,
    lineHeight: 20,
    backgroundColor: "rgba(185, 28, 28, 0.7)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  overlayAuthenticated: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.2)",
  },
  shellTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(226, 232, 240, 0.95)",
  },
  shellBrandBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  shellBrandIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#7c3aed",
  },
  shellBrandName: {
    color: "#1f2937",
    fontSize: 16,
    fontWeight: "800",
  },
  shellBrandSubtitle: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
  },
  shellTopAction: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  interiorScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  interiorSection: {
    gap: 16,
  },
  greetingEyebrow: {
    color: "rgba(255,255,255,0.94)",
    fontSize: 18,
    fontWeight: "700",
  },
  greetingName: {
    marginTop: -8,
    color: "#ffffff",
    fontSize: 38,
    lineHeight: 42,
    fontWeight: "900",
  },
  pointsCard: {
    overflow: "hidden",
    borderRadius: 28,
    padding: 22,
    backgroundColor: "#6d28d9",
    shadowColor: "#4c1d95",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 14,
    gap: 16,
  },
  pointsGlowPrimary: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    top: -80,
    right: -50,
  },
  pointsGlowSecondary: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 999,
    backgroundColor: "rgba(167, 139, 250, 0.18)",
    bottom: -55,
    left: -28,
  },
  pointsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pointsLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pointsIconBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  pointsLabel: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  pointsValueRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  pointsValue: {
    color: "#ffffff",
    fontSize: 66,
    lineHeight: 72,
    fontWeight: "900",
  },
  pointsUnit: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 24,
    fontWeight: "800",
    paddingBottom: 10,
  },
  pointsHintPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pointsHintText: {
    color: "#f5f3ff",
    fontSize: 13,
    fontWeight: "600",
  },
  shortcutsTitle: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  shortcutCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.94)",
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  shortcutIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  shortcutIconPrimary: {
    backgroundColor: "#7c3aed",
  },
  shortcutIconWarning: {
    backgroundColor: "#f59e0b",
  },
  shortcutBody: {
    flex: 1,
    gap: 2,
  },
  shortcutHeading: {
    color: "#111827",
    fontSize: 18,
    fontWeight: "800",
  },
  shortcutDescription: {
    color: "#64748b",
    fontSize: 14,
    lineHeight: 20,
  },
  badgeSoon: {
    borderRadius: 999,
    backgroundColor: "#fef3c7",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeSoonText: {
    color: "#b45309",
    fontSize: 11,
    fontWeight: "900",
  },
  sectionScreenTitle: {
    color: "#ffffff",
    fontSize: 30,
    fontWeight: "900",
  },
  sectionScreenSubtitle: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    lineHeight: 22,
    marginTop: -8,
  },
  infoCard: {
    borderRadius: 24,
    backgroundColor: "rgba(248, 250, 252, 0.94)",
    padding: 20,
    gap: 12,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  infoCardTitle: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "800",
  },
  infoCardText: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 22,
  },
  promotionCard: {
    borderRadius: 24,
    backgroundColor: "rgba(248, 250, 252, 0.96)",
    padding: 18,
    gap: 12,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  promotionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  promotionBadgePrimary: {
    borderRadius: 999,
    backgroundColor: "#ede9fe",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  promotionBadgePrimaryText: {
    color: "#6d28d9",
    fontSize: 12,
    fontWeight: "900",
  },
  promotionBadgeSecondary: {
    flexShrink: 1,
    borderRadius: 999,
    backgroundColor: "#e0f2fe",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  promotionBadgeSecondaryText: {
    color: "#0369a1",
    fontSize: 11,
    fontWeight: "800",
  },
  promotionTitle: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "800",
  },
  promotionDescription: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 21,
  },
  promotionVoucherPanel: {
    borderRadius: 22,
    backgroundColor: "#f8fafc",
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  promotionVoucherPanelIssued: {
    backgroundColor: "#f5f3ff",
    borderColor: "#ddd6fe",
  },
  promotionVoucherTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  promotionVoucherIdentity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  promotionVoucherIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "#ede9fe",
    alignItems: "center",
    justifyContent: "center",
  },
  promotionVoucherIconWrapIssued: {
    backgroundColor: "#ffffff",
  },
  promotionVoucherIdentityText: {
    flex: 1,
    gap: 2,
  },
  promotionVoucherLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  promotionVoucherStatus: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "800",
  },
  promotionVoucherStateBadge: {
    borderRadius: 999,
    backgroundColor: "#eef2ff",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  promotionVoucherStateBadgeIssued: {
    backgroundColor: "#6d28d9",
  },
  promotionVoucherStateBadgeText: {
    color: "#6d28d9",
    fontSize: 11,
    fontWeight: "900",
  },
  promotionVoucherStateBadgeTextIssued: {
    color: "#ffffff",
  },
  promotionVoucherCode: {
    color: "#4c1d95",
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "900",
    letterSpacing: 2.6,
  },
  promotionVoucherCodePending: {
    color: "#94a3b8",
    fontSize: 18,
    letterSpacing: 0.2,
  },
  promotionVoucherHint: {
    color: "#5b6475",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },
  promotionVoucherValidityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: -2,
  },
  promotionVoucherValidityText: {
    color: "#5b21b6",
    fontSize: 12,
    fontWeight: "800",
  },
  promotionInfoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  promotionInfoChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.94)",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  promotionInfoChipText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "700",
  },
  promotionMetaList: {
    gap: 4,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.82)",
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  promotionMetaText: {
    color: "#475569",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  promotionVoucherButton: {
    borderRadius: 18,
    backgroundColor: "#6d28d9",
    minHeight: 48,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  promotionVoucherButtonIssued: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8b4fe",
  },
  promotionVoucherButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },
  promotionVoucherButtonTextIssued: {
    color: "#6d28d9",
  },
  profileCard: {
    borderRadius: 24,
    backgroundColor: "rgba(248, 250, 252, 0.94)",
    padding: 20,
    gap: 18,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6d28d9",
  },
  profileAvatarText: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
  },
  profileHeaderText: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "800",
  },
  profileCompany: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: "600",
  },
  profileDetails: {
    borderRadius: 18,
    backgroundColor: "#ffffff",
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  profileLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  profileValue: {
    color: "#0f172a",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  profileInput: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 14,
    fontSize: 15,
    color: "#0f172a",
  },
  profileErrorText: {
    textAlign: "center",
    color: "#ffffff",
    fontSize: 13,
    lineHeight: 18,
    backgroundColor: "rgba(185, 28, 28, 0.75)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  profileSuccessText: {
    textAlign: "center",
    color: "#0f172a",
    fontSize: 13,
    lineHeight: 18,
    backgroundColor: "rgba(34, 197, 94, 0.22)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontWeight: "700",
  },
  profileSaveButton: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: "#0f766e",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  profileLogoutButton: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: "#6d28d9",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  bottomTabBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginHorizontal: 18,
    marginBottom: 12,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.94)",
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 4,
  },
  tabLabel: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
  },
  tabLabelActive: {
    color: "#6d28d9",
  },
});

export default App;
