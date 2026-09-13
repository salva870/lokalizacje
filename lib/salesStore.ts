import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { SaleItemInput, SaleSessionDetail, SaleSessionSummary } from "@/lib/types";
import { applyMovement } from "@/lib/store";

type StoredAttachment = {
  id: string;
  itemId: string;
  storagePath: string;
  mimeType: string;
  originalName?: string;
  createdAt: string;
};

type StoredItem = {
  id: string;
  sku?: string;
  qty: number;
  fromLocationCode?: string;
  movementId?: string;
  note?: string;
  sortOrder: number;
};

type StoredSession = {
  id: string;
  createdAt: string;
  operatorId: string;
  note?: string;
  items: StoredItem[];
  attachments: StoredAttachment[];
};

const salesRoot = path.join(process.cwd(), "logs", "sales");
const salesIndexPath = path.join(process.cwd(), "logs", "sales-sessions.json");
const sessions: StoredSession[] = [];

function ensureSalesDirs() {
  fs.mkdirSync(salesRoot, { recursive: true });
}

function loadSessionsFromDisk() {
  try {
    if (!fs.existsSync(salesIndexPath)) return;
    const raw = fs.readFileSync(salesIndexPath, "utf8");
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw) as StoredSession[];
    sessions.length = 0;
    sessions.push(...parsed);
  } catch {
    // ignore invalid file
  }
}

function flushSessionsToDisk() {
  try {
    ensureSalesDirs();
    fs.writeFileSync(salesIndexPath, JSON.stringify(sessions, null, 2), "utf8");
  } catch {
    // ignore write errors
  }
}

loadSessionsFromDisk();

function toSummary(session: StoredSession): SaleSessionSummary {
  const pieceCount = session.items.reduce((sum, item) => sum + item.qty, 0);
  return {
    id: session.id,
    createdAt: session.createdAt,
    operatorId: session.operatorId,
    itemCount: session.items.length,
    pieceCount,
    photoCount: session.attachments.length,
    note: session.note,
  };
}

function attachmentUrl(id: string) {
  return `/api/sales/attachments/${id}`;
}

export function listSaleSessionsLocal(limit = 50): SaleSessionSummary[] {
  return sessions
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map(toSummary);
}

export function getSaleSessionLocal(id: string): SaleSessionDetail | null {
  const session = sessions.find((entry) => entry.id === id);
  if (!session) return null;
  const summary = toSummary(session);
  const attachmentsByItem = new Map<string, StoredAttachment[]>();
  for (const attachment of session.attachments) {
    const list = attachmentsByItem.get(attachment.itemId) ?? [];
    list.push(attachment);
    attachmentsByItem.set(attachment.itemId, list);
  }
  return {
    ...summary,
    items: session.items
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({
        id: item.id,
        sku: item.sku,
        qty: item.qty,
        fromLocationCode: item.fromLocationCode,
        movementId: item.movementId,
        note: item.note,
        attachments: (attachmentsByItem.get(item.id) ?? []).map((attachment) => ({
          id: attachment.id,
          mimeType: attachment.mimeType,
          originalName: attachment.originalName,
          url: attachmentUrl(attachment.id),
        })),
      })),
  };
}

export type SaleAttachmentBuffer = {
  clientKey: string;
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
};

export function createSaleSessionLocal(
  operatorId: string,
  items: SaleItemInput[],
  attachments: SaleAttachmentBuffer[],
  note?: string,
) {
  if (items.length === 0) {
    throw new Error("Lista sprzedazy jest pusta.");
  }

  ensureSalesDirs();
  const sessionId = randomUUID();
  const createdAt = new Date().toISOString();
  const storedItems: StoredItem[] = [];
  const storedAttachments: StoredAttachment[] = [];
  const attachmentByKey = new Map(attachments.map((entry) => [entry.clientKey, entry]));

  items.forEach((item, index) => {
    const itemId = randomUUID();
    let movementId: string | undefined;
    const sku = item.sku?.trim().toUpperCase();

    if (sku) {
      const movement = applyMovement({
        operatorId,
        movementType: "MOVE_TO_SALE",
        sku,
        qty: item.qty,
        fromLocationCode: item.fromLocationCode,
        referenceNo: sessionId,
      });
      movementId = movement.id;
    }

    storedItems.push({
      id: itemId,
      sku: sku || undefined,
      qty: item.qty,
      fromLocationCode: item.fromLocationCode?.trim().toUpperCase() || undefined,
      movementId,
      note: item.note?.trim() || undefined,
      sortOrder: index,
    });

    if (item.clientKey) {
      const file = attachmentByKey.get(item.clientKey);
      if (file) {
        const attachmentId = randomUUID();
        const ext = file.mimeType.includes("png") ? "png" : file.mimeType.includes("webp") ? "webp" : "jpg";
        const relPath = path.join(sessionId, `${attachmentId}.${ext}`);
        const absPath = path.join(salesRoot, relPath);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, file.buffer);
        storedAttachments.push({
          id: attachmentId,
          itemId,
          storagePath: relPath,
          mimeType: file.mimeType,
          originalName: file.originalName,
          createdAt,
        });
      }
    }
  });

  const session: StoredSession = {
    id: sessionId,
    createdAt,
    operatorId,
    note: note?.trim() || undefined,
    items: storedItems,
    attachments: storedAttachments,
  };
  sessions.unshift(session);
  flushSessionsToDisk();

  const detail = getSaleSessionLocal(sessionId);
  if (!detail) throw new Error("Nie udalo sie zapisac sesji sprzedazy.");
  return detail;
}

export function readSaleAttachmentLocal(id: string): { buffer: Buffer; mimeType: string } | null {
  for (const session of sessions) {
    const attachment = session.attachments.find((entry) => entry.id === id);
    if (!attachment) continue;
    const absPath = path.join(salesRoot, attachment.storagePath);
    if (!fs.existsSync(absPath)) return null;
    return { buffer: fs.readFileSync(absPath), mimeType: attachment.mimeType };
  }
  return null;
}
