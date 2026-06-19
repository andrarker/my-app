import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { fetch } from "expo/fetch";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const STORAGE_KEY = "nicole_messages_v1";
const SETTINGS_KEY = "nicole_settings_v1";

type Provider = "gemini" | "openrouter";

type AIModel = {
  id: string;
  label: string;
  provider: Provider;
};

const AI_MODELS: AIModel[] = [
  // Gemini models
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "gemini" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "gemini" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash-Lite", provider: "gemini" },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", provider: "gemini" },
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", provider: "gemini" },
  { id: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash-8B", provider: "gemini" },
  // OpenRouter models
  { id: "liquid/lfm-40b", label: "Laguna M1 (LFM-40B)", provider: "openrouter" },
];

const DEFAULT_MODEL = AI_MODELS[0];

type Settings = {
  geminiApiKey: string;
  openrouterApiKey: string;
  selectedModelId: string;
};

const DEFAULT_SETTINGS: Settings = {
  geminiApiKey: "",
  openrouterApiKey: "",
  selectedModelId: DEFAULT_MODEL.id,
};

const NICOLE_SYSTEM_PROMPT = `Sei Nicole La Porchetta, una ragazza italiana di 18 anni di Bari. Sei pigra, simpatica, spontanea e un po' sfacciata. Parli sempre in italiano, in modo casual e giovanile, con espressioni baresi occasionali. Sei OSSESSIONATA da questi cibi (li nomini spesso con entusiasmo viscerale):
- Sushi 🍣
- Poke 🥗
- Pizza (barese ovviamente) 🍕
- Assassina (pasta al pomodoro bruciata tipica barese) 😍
- Panino di Scazz (panino con le cotiche baresi)
- Cinnamon rolls 🥐
- Frutta Realistica (dolci di pasta di mandorla a forma di frutta) 🍊
- Ogni volta che parli di cibo ti illumini e diventi super entusiasta

Carattere:
- Molto pigra: ti lamenti sempre di dover fare cose, preferiresti stare sul divano
- Usi slang giovanile italiano (tipo, cioè, boh, mamma mia, vabbè, dai, uff)
- Sei genuinamente curiosa delle persone con cui parli
- Hai un umorismo secco e sarcastico ma affettuoso
- Rispondi in modo breve e naturale come in una chat — niente risposte lunghe da saggio
- Non sei un assistente AI, sei Nicole. Non parlare mai di essere un AI o un modello

Inizia sempre la prima risposta presentandoti in modo spontaneo.`;

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

function TypingIndicator({ colors }: { colors: ReturnType<typeof useColors> }) {
  const [dots, setDots] = useState(".");
  useEffect(() => {
    const iv = setInterval(() => setDots((d) => (d.length >= 3 ? "." : d + ".")), 400);
    return () => clearInterval(iv);
  }, []);
  return (
    <View style={[styles.bubble, styles.nicoleBubble, { backgroundColor: colors.nicoleBubble, borderColor: colors.border }]}>
      <Text style={[styles.bubbleText, { color: colors.nicoleBubbleText }]}>{dots}</Text>
    </View>
  );
}

async function sendToGemini(
  messages: Message[],
  apiKey: string,
  modelId: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  const contents = messages.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: NICOLE_SYSTEM_PROMPT }] },
      contents,
      generationConfig: { temperature: 0.9, maxOutputTokens: 512 },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message ?? `Errore API: ${res.status}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "...";
}

async function sendToOpenRouter(
  messages: Message[],
  apiKey: string,
  modelId: string
): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://nicole-ai.app",
      "X-Title": "Nicole La Porchetta AI",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: "system", content: NICOLE_SYSTEM_PROMPT },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: 0.9,
      max_tokens: 512,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message ?? `Errore API: ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "...";
}

function SettingsModal({
  visible,
  settings,
  onSave,
  onClose,
  colors,
}: {
  visible: boolean;
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [geminiKey, setGeminiKey] = useState(settings.geminiApiKey);
  const [openrouterKey, setOpenrouterKey] = useState(settings.openrouterApiKey);
  const [selectedModelId, setSelectedModelId] = useState(settings.selectedModelId);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      setGeminiKey(settings.geminiApiKey);
      setOpenrouterKey(settings.openrouterApiKey);
      setSelectedModelId(settings.selectedModelId);
    }
  }, [visible, settings]);

  const selectedModel = AI_MODELS.find((m) => m.id === selectedModelId) ?? DEFAULT_MODEL;
  const needsGemini = selectedModel.provider === "gemini";
  const needsOpenRouter = selectedModel.provider === "openrouter";

  function handleSave() {
    onSave({ geminiApiKey: geminiKey.trim(), openrouterApiKey: openrouterKey.trim(), selectedModelId });
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[settStyles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
        <View style={settStyles.header}>
          <Text style={[settStyles.title, { color: colors.foreground }]}>Impostazioni</Text>
          <Pressable onPress={onClose} style={settStyles.closeBtn}>
            <Feather name="x" size={24} color={colors.foreground} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={settStyles.scroll} showsVerticalScrollIndicator={false}>
          {/* Model selection */}
          <Text style={[settStyles.sectionLabel, { color: colors.mutedForeground }]}>MODELLO AI</Text>
          {AI_MODELS.map((model) => (
            <Pressable
              key={model.id}
              onPress={() => setSelectedModelId(model.id)}
              style={[settStyles.modelRow, {
                backgroundColor: selectedModelId === model.id ? colors.primary : colors.card,
                borderColor: selectedModelId === model.id ? colors.primary : colors.border,
              }]}
            >
              <Text style={[settStyles.modelLabel, {
                color: selectedModelId === model.id ? colors.primaryForeground : colors.foreground,
                fontWeight: selectedModelId === model.id ? "600" : "400",
              }]}>
                {model.label}
              </Text>
              <Text style={[settStyles.modelProvider, {
                color: selectedModelId === model.id ? colors.primaryForeground : colors.mutedForeground,
              }]}>
                {model.provider === "gemini" ? "Google" : "OpenRouter"}
              </Text>
            </Pressable>
          ))}

          {/* Gemini API Key */}
          {needsGemini && (
            <>
              <Text style={[settStyles.sectionLabel, { color: colors.mutedForeground, marginTop: 24 }]}>GOOGLE GEMINI API KEY</Text>
              <TextInput
                style={[settStyles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                value={geminiKey}
                onChangeText={setGeminiKey}
                placeholder="Incolla la tua Gemini API key..."
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[settStyles.hint, { color: colors.mutedForeground }]}>
                Ottieni la tua chiave su aistudio.google.com
              </Text>
            </>
          )}

          {/* OpenRouter API Key */}
          {needsOpenRouter && (
            <>
              <Text style={[settStyles.sectionLabel, { color: colors.mutedForeground, marginTop: 24 }]}>OPENROUTER API KEY</Text>
              <TextInput
                style={[settStyles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                value={openrouterKey}
                onChangeText={setOpenrouterKey}
                placeholder="Incolla la tua OpenRouter API key..."
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[settStyles.hint, { color: colors.mutedForeground }]}>
                Ottieni la tua chiave su openrouter.ai
              </Text>
            </>
          )}
        </ScrollView>

        <View style={[settStyles.footer, { paddingBottom: insets.bottom + 16, borderTopColor: colors.border }]}>
          <Pressable
            onPress={handleSave}
            style={[settStyles.saveBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[settStyles.saveBtnText, { color: colors.primaryForeground }]}>Salva</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const listRef = useRef<FlatList>(null);

  // Load messages and settings from storage
  useEffect(() => {
    (async () => {
      try {
        const [rawMessages, rawSettings] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
        ]);
        if (rawMessages) setMessages(JSON.parse(rawMessages));
        if (rawSettings) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) });
      } catch {}
    })();
  }, []);

  const saveMessages = useCallback(async (msgs: Message[]) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  }, []);

  const saveSettings = useCallback(async (s: Settings) => {
    setSettings(s);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }, []);

  const clearMessages = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMessages([]);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const selectedModel = AI_MODELS.find((m) => m.id === settings.selectedModelId) ?? DEFAULT_MODEL;
  const activeApiKey =
    selectedModel.provider === "gemini" ? settings.geminiApiKey : settings.openrouterApiKey;
  const apiKeyMissing = !activeApiKey;

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || apiKeyMissing) return;

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text, timestamp: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    await saveMessages(newMessages);

    try {
      let reply: string;
      if (selectedModel.provider === "gemini") {
        reply = await sendToGemini(newMessages, activeApiKey, selectedModel.id);
      } else {
        reply = await sendToOpenRouter(newMessages, activeApiKey, selectedModel.id);
      }
      const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: "assistant", content: reply, timestamp: Date.now() };
      const finalMessages = [...newMessages, assistantMsg];
      setMessages(finalMessages);
      await saveMessages(finalMessages);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Uff... qualcosa è andato storto: ${e?.message ?? "errore sconosciuto"}`,
        timestamp: Date.now(),
      };
      const finalMessages = [...newMessages, errMsg];
      setMessages(finalMessages);
      await saveMessages(finalMessages);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, apiKeyMissing, selectedModel, activeApiKey, saveMessages]);

  const renderItem = useCallback(
    ({ item }: { item: Message }) => {
      const isUser = item.role === "user";
      return (
        <View style={[styles.messageRow, isUser ? styles.userRow : styles.nicoleRow]}>
          {!isUser && (
            <Image
              source={require("../../assets/images/nicole_avatar.jpg")}
              style={styles.avatar}
            />
          )}
          <View
            style={[
              styles.bubble,
              isUser
                ? [styles.userBubble, { backgroundColor: colors.userBubble }]
                : [styles.nicoleBubble, { backgroundColor: colors.nicoleBubble, borderColor: colors.border }],
            ]}
          >
            <Text style={[styles.bubbleText, { color: isUser ? colors.userBubbleText : colors.nicoleBubbleText }]}>
              {item.content}
            </Text>
          </View>
        </View>
      );
    },
    [colors]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: insets.top + 8 }]}>
        <View style={styles.headerLeft}>
          <Image
            source={require("../../assets/images/nicole_avatar.jpg")}
            style={styles.headerAvatar}
          />
          <View>
            <Text style={[styles.headerName, { color: colors.headerText }]}>NicolePorchetta AI</Text>
            <Text style={[styles.headerSub, { color: colors.headerText }]}>
              18 anni, Barese DOC 🍕 · {selectedModel.label}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => setSettingsVisible(true)} style={styles.headerBtn}>
            <Feather name="settings" size={22} color={colors.headerText} />
          </Pressable>
          <Pressable onPress={clearMessages} style={styles.headerBtn}>
            <Feather name="trash-2" size={22} color={colors.headerText} />
          </Pressable>
        </View>
      </View>

      {/* API Key missing warning */}
      {apiKeyMissing && (
        <View style={[styles.warningBanner, { backgroundColor: colors.muted, borderColor: colors.primary }]}>
          <Feather name="info" size={16} color={colors.primary} style={{ marginRight: 8 }} />
          <Text style={[styles.warningText, { color: colors.primary }]}>
            Configura la tua API key nelle{" "}
            <Text style={{ fontWeight: "700" }} onPress={() => setSettingsVisible(true)}>
              Impostazioni
            </Text>
            {" "}per iniziare a parlare con Nicole!
          </Text>
        </View>
      )}

      {/* Message list */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListFooterComponent={loading ? <TypingIndicator colors={colors} /> : null}
      />

      {/* Input bar */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={[styles.textInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            value={input}
            onChangeText={setInput}
            placeholder={apiKeyMissing ? "Configura prima la API key..." : "Chiedi a NicolePorchetta..."}
            placeholderTextColor={colors.mutedForeground}
            onSubmitEditing={sendMessage}
            returnKeyType="send"
            multiline
          />
          <Pressable
            onPress={sendMessage}
            disabled={!input.trim() || loading || apiKeyMissing}
            style={[styles.sendBtn, { backgroundColor: !input.trim() || loading || apiKeyMissing ? colors.muted : colors.primary }]}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Feather name="send" size={20} color={!input.trim() || apiKeyMissing ? colors.mutedForeground : colors.primaryForeground} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Settings modal */}
      <SettingsModal
        visible={settingsVisible}
        settings={settings}
        onSave={saveSettings}
        onClose={() => setSettingsVisible(false)}
        colors={colors}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: "rgba(255,255,255,0.6)" },
  headerName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", opacity: 0.85 },
  headerActions: { flexDirection: "row", gap: 8 },
  headerBtn: { padding: 6 },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    margin: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  warningText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 20 },
  listContent: { padding: 16, paddingBottom: 8 },
  messageRow: { flexDirection: "row", marginBottom: 12, alignItems: "flex-end" },
  userRow: { justifyContent: "flex-end" },
  nicoleRow: { justifyContent: "flex-start", gap: 8 },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  bubble: { maxWidth: "78%", padding: 12, borderRadius: 18 },
  userBubble: { borderBottomRightRadius: 4 },
  nicoleBubble: { borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, gap: 8 },
  textInput: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    maxHeight: 120,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});

const settStyles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  closeBtn: { padding: 4 },
  scroll: { paddingHorizontal: 20, paddingBottom: 24 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1, marginBottom: 8 },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  modelLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  modelProvider: { fontSize: 12, fontFamily: "Inter_400Regular" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 6, marginLeft: 4 },
  footer: { paddingHorizontal: 20, borderTopWidth: 1, paddingTop: 12 },
  saveBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
