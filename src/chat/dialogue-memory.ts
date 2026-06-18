import type { DialogueHistoryMessage } from "./suspect-chat.js";

export class DialogueMemory {
  private readonly messagesByCharacter = new Map<string, DialogueHistoryMessage[]>();

  getHistory(characterId: string): DialogueHistoryMessage[] {
    return [...(this.messagesByCharacter.get(characterId) ?? [])];
  }

  replaceHistory(characterId: string, history: DialogueHistoryMessage[]) {
    this.messagesByCharacter.set(
      characterId,
      history
        .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
        .map((message) => ({ role: message.role, content: message.content })),
    );
  }

  append(characterId: string, message: DialogueHistoryMessage) {
    const history = this.messagesByCharacter.get(characterId) ?? [];
    history.push({ role: message.role, content: message.content });
    this.messagesByCharacter.set(characterId, history);
  }

  clear() {
    this.messagesByCharacter.clear();
  }
}

export function sanitizeDialogueHistory(input: unknown): DialogueHistoryMessage[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter(
      (message) =>
        message &&
        typeof message === "object" &&
        ((message as { role?: unknown }).role === "user" || (message as { role?: unknown }).role === "assistant") &&
        typeof (message as { content?: unknown }).content === "string",
    )
    .map((message) => ({
      role: (message as { role: "user" | "assistant" }).role,
      content: (message as { content: string }).content,
    }));
}
