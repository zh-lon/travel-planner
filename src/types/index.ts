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
  planParams?: string | null; // AI 规划参数 JSON（出发地/人数/预算/节奏/偏好等）
  ownerId?: string | null;
  owner?: UserPublic | null;
  access?: { role: TripRole };
  researchWeb?: string | null;
  researchWebAt?: string | null;
  researchXhs?: string | null;
  researchXhsAt?: string | null;
  researchAi?: string | null;
  researchAiAt?: string | null;
  shareToken?: string | null; // 随身行程手册在线分享码
  shareTokenAt?: string | null;
  places?: string[]; // 行程中的地点列表（去重，最多 8 个）
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
  needBooking: boolean; // 是否需要提前预约
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
  // 该地点所在城市（多城市行程时用于精确地理搜索；单城市或交通/无固定地点可为 null）
  city: string | null;
  estimatedCost: number | null;
  needBooking?: boolean; // AI 方案可选给出：是否需要提前预约
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
