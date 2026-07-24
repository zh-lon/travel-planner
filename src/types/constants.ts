// 行程项类型常量：值 / 中文标签 / 标签颜色（antd Tag）
export const ITEM_TYPES = [
  { value: "SIGHT", label: "景点", color: "green" },
  { value: "TRANSPORT", label: "交通", color: "blue" },
  { value: "HOTEL", label: "住宿", color: "purple" },
  { value: "FOOD", label: "餐饮", color: "orange" },
  { value: "SHOPPING", label: "购物", color: "magenta" },
  { value: "OTHER", label: "其他", color: "default" },
] as const;

export type ItemTypeValue = (typeof ITEM_TYPES)[number]["value"];

export const ITEM_TYPE_VALUES: string[] = ITEM_TYPES.map((t) => t.value);

export function itemTypeMeta(value: string) {
  return ITEM_TYPES.find((t) => t.value === value) ?? ITEM_TYPES[ITEM_TYPES.length - 1];
}

// 开销分类（与行程项类型相近，但以「门票」替代「景点」）
export const EXPENSE_CATEGORIES = [
  { value: "TRANSPORT", label: "交通", color: "blue" },
  { value: "HOTEL", label: "住宿", color: "purple" },
  { value: "FOOD", label: "餐饮", color: "orange" },
  { value: "TICKET", label: "门票", color: "green" },
  { value: "SHOPPING", label: "购物", color: "magenta" },
  { value: "OTHER", label: "其他", color: "default" },
] as const;

export const EXPENSE_CATEGORY_VALUES: string[] = EXPENSE_CATEGORIES.map((c) => c.value);

export function expenseCategoryMeta(value: string) {
  return (
    EXPENSE_CATEGORIES.find((c) => c.value === value) ??
    EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]
  );
}

// 地图/看板按天配色
export const DAY_COLORS = [
  "#1677ff",
  "#52c41a",
  "#fa8c16",
  "#eb2f96",
  "#722ed1",
  "#13c2c2",
  "#f5222d",
  "#a0d911",
  "#2f54eb",
  "#d4b106",
];

export function dayColor(dayIndex: number): string {
  return DAY_COLORS[dayIndex % DAY_COLORS.length];
}
