// API 传输层类型（日期为 ISO 字符串）

export interface UserPublic {
  id: string;
  username: string;
  displayName: string | null;
  isAdmin?: boolean;
  totpEnabled?: boolean;
}

export type TripRole = "owner" | "edit" | "read";

export interface TripSummary {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  budgetTotal: number | null;
  notes: string | null;
  ownerId?: string | null;
  owner?: UserPublic | null;
  access?: { role: TripRole };
  researchSummary?: string | null;
  researchAt?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { items: number };
}

export interface ItineraryItemT {
  id: string;
  tripId: string;
  dayIndex: number;
  sortOrder: number;
  type: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  placeName: string | null;
  lng: number | null;
  lat: number | null;
  address: string | null;
  estimatedCost: number | null;
  notes: string | null;
  transportMode: string | null; // 从上一个点到本点的交通方式，空 = 跟随全局默认
  aiGenerated: boolean;
}

export interface TripDetail extends TripSummary {
  items: ItineraryItemT[];
  shares?: { userId: string; canEdit: boolean; user: UserPublic }[];
}

export interface ExpenseT {
  id: string;
  tripId: string;
  date: string;
  category: string;
  title: string;
  amount: number;
  payer: string | null;
  participants: string[]; // 分摊人；空数组 = 不参与分摊
  itemId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ChecklistItemT {
  id: string;
  tripId: string;
  text: string;
  checked: boolean;
  sortOrder: number;
}

// AI 生成的行程方案（导入前的中间结构）
export interface AiPlanItem {
  type: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  placeName: string | null;
  estimatedCost: number | null;
  notes: string | null;
  lng: number | null;
  lat: number | null;
  address: string | null;
}

export interface AiPlanDay {
  theme: string | null;
  items: AiPlanItem[];
}

export interface AiPlan {
  days: AiPlanDay[];
}
