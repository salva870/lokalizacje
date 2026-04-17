export type Zone = "SKLEP" | "ZAPLECZE";

export type LocationType =
  | "DISPLAY"
  | "BUFFER"
  | "RESERVED"
  | "BACKROOM_BOX"
  | "BACKROOM_SHELF"
  | "INACTIVE";

export type MovementType =
  | "ADD"
  | "REMOVE"
  | "MOVE"
  | "RESTORE_FROM_TMP"
  | "MOVE_TO_SALE"
  | "SALE_FINALIZE";

export type Role = "ADMIN" | "OPERATOR";

export interface Location {
  code: string;
  name: string;
  parentZone: Zone;
  locationType: LocationType;
  isActive: boolean;
}

export interface StockMovement {
  id: string;
  createdAt: string;
  operatorId: string;
  movementType: MovementType;
  sku: string;
  qty: number;
  fromLocationCode?: string;
  toLocationCode?: string;
  referenceNo?: string;
}

export interface User {
  id: string;
  login: string;
  passwordHash: string;
  role: Role;
}
