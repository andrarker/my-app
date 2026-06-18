import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { fetch } from "expo/fetch";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "";
const STORAGE_KEY = "nicole_messages_v1";

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
  const [dot, setDot] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDot((d) => (d + 1) % 3), 400);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={[styles.bubbleRow, styles.nicoleRow]}>
      <View style={styles.avatarSmall}>
        <Text style={styles.avatarEmoji}>🍕</Text>
      </View>
      <View
        style={[
          styles.bubble,
          styles.nicoleBubble,
          { backgroundColor: colors.nicoleBubble },
        ]}
      >
        <Text style={[styles.bubbleText, { color: colors.nicoleBubbleText }]}>
          {dot === 0 ? "●○○" : dot === 1 ? "○●○" : "○○●"}
        </Text>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          setMessages(JSON.parse(raw));
        } catch {}
      }
      setLoaded(true);
    });
  }, []);

  const saveMessages = useCallback((msgs: Message[]) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isTyping) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput("");

    const userMsg: Message = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    const updated = [...messages, userMsg];
    setMessages(updated);
    saveMessages(updated);
    setIsTyping(true);

    const history = updated.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: NICOLE_SYSTEM_PROMPT }],
            },
            contents: history,
            generationConfig: {
              maxOutputTokens: 500,
              temperature: 1.1,
            },
          }),
        }
      );

      const data = await response.json();
      const reply =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ??
        "Uff, non riesco a rispondere ora 😴";

      const assistantMsg: Message = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        role: "assistant",
        content: reply,
        timestamp: Date.now(),
      };

      const final = [...updated, assistantMsg];
      setMessages(final);
      saveMessages(final);
    } catch {
      const errMsg: Message = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        role: "assistant",
        content: "Oddio, qualcosa è andato storto... vabbè 😴",
        timestamp: Date.now(),
      };
      const final = [...updated, errMsg];
      setMessages(final);
      saveMessages(final);
    } finally {
      setIsTyping(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [input, isTyping, messages, saveMessages]);

  const clearChat = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMessages([]);
    AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => {
      const isUser = item.role === "user";
      return (
        <View
          style={[styles.bubbleRow, isUser ? styles.userRow : styles.nicoleRow]}
        >
          {!isUser && (
            <View style={styles.avatarSmall}>
              <Text style={styles.avatarEmoji}>🍕</Text>
            </View>
          )}
          <View
            style={[
              styles.bubble,
              isUser
                ? [styles.userBubble, { backgroundColor: colors.userBubble }]
                : [
                    styles.nicoleBubble,
                    { backgroundColor: colors.nicoleBubble },
                  ],
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                {
                  color: isUser
                    ? colors.userBubbleText
                    : colors.nicoleBubbleText,
                },
              ]}
            >
              {item.content}
            </Text>
          </View>
        </View>
      );
    },
    [colors]
  );

  if (!loaded) {
    return (
      <View
        style={[styles.loadingContainer, { backgroundColor: colors.background }]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const headerHeight = 60;
  const topPad = insets.top + headerHeight;
  const bottomPad = insets.bottom + 64;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            paddingTop: insets.top + 10,
            paddingBottom: 12,
          },
        ]}
      >
        <View style={styles.headerLeft}>
          <View style={styles.avatarBig}>
            <Text style={styles.avatarBigEmoji}>🍕</Text>
          </View>
          <View>
            <Text style={[styles.headerName, { color: colors.headerText }]}>
              Nicole La Porchetta
            </Text>
            <Text style={[styles.headerSub, { color: colors.headerText }]}>
              18 anni • Barese DOC 🍕
            </Text>
          </View>
        </View>
        <Pressable onPress={clearChat} style={styles.clearBtn} hitSlop={12}>
          <Feather name="trash-2" size={20} color={colors.headerText} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={[...messages].reverse()}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          inverted
          contentContainerStyle={{
            paddingTop: 16,
            paddingBottom: 8,
            paddingHorizontal: 12,
          }}
          ListHeaderComponent={isTyping ? <TypingIndicator colors={colors} /> : null}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={
            messages.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyEmoji}>🍣🍕🥗</Text>
                <Text
                  style={[styles.emptyTitle, { color: colors.foreground }]}
                >
                  Ciao! Sono Nicole
                </Text>
                <Text
                  style={[
                    styles.emptySubtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Scrivi qualcosa... ma non chiedermi di fare troppe cose, sono
                  pigra 😴
                </Text>
              </View>
            ) : null
          }
        />

        {/* Input bar */}
        <View
          style={[
            styles.inputBar,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom: insets.bottom + 8,
            },
          ]}
        >
          <TextInput
            style={[
              styles.textInput,
              {
                backgroundColor: colors.secondary,
                color: colors.foreground,
                borderColor: colors.border,
              },
            ]}
            value={input}
            onChangeText={setInput}
            placeholder="Scrivi a Nicole..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={500}
            returnKeyType="default"
          />
          <Pressable
            onPress={sendMessage}
            disabled={!input.trim() || isTyping}
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor:
                  !input.trim() || isTyping
                    ? colors.muted
                    : colors.primary,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            {isTyping ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="send" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 4,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerName: { fontSize: 17, fontWeight: "700" as const },
  headerSub: { fontSize: 12, opacity: 0.85, marginTop: 1 },
  avatarBig: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.25)",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarBigEmoji: { fontSize: 22 },
  clearBtn: { padding: 4 },

  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginVertical: 3,
  },
  userRow: { justifyContent: "flex-end" },
  nicoleRow: { justifyContent: "flex-start" },
  avatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#fce4ed",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
  },
  avatarEmoji: { fontSize: 14 },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 2,
    elevation: 1,
  },
  userBubble: { borderBottomRightRadius: 4 },
  nicoleBubble: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },

  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    borderWidth: 1,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
  },

  emptyContainer: {
    alignItems: "center",
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: "700" as const, marginBottom: 8 },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
