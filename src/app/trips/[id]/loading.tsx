import { Spin } from "antd";

// 行程详情路由的加载态：跳转/首次编译期间给出反馈，而不是页面毫无反应
export default function Loading() {
  return (
    <div style={{ textAlign: "center", padding: 80 }}>
      <Spin size="large" />
    </div>
  );
}
