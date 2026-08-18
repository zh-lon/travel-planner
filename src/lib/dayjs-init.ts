import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

// 全局设置 dayjs 中文 locale，确保 SSR 和客户端渲染一致
// 此文件需在 layout.tsx（Server Component）和 AppShell.tsx（Client Component）中同时引入
dayjs.locale("zh-cn");