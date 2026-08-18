"use client";

// 工作流步骤条：竖向展示各步骤的执行状态（执行中/完成/失败），供 AI 助手与行程生成共用
import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined } from "@ant-design/icons";

export interface WorkflowStepItem {
  id: string;
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
}

export default function WorkflowSteps({ steps }: { steps: WorkflowStepItem[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
      {steps.map((s, i) => (
        <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 16, flexShrink: 0 }}>
            {s.status === "running" ? (
              <LoadingOutlined spin style={{ color: "#0d9488", fontSize: 14 }} />
            ) : s.status === "done" ? (
              <CheckCircleFilled style={{ color: "#52c41a", fontSize: 14 }} />
            ) : (
              <CloseCircleFilled style={{ color: "#ff4d4f", fontSize: 14 }} />
            )}
            {i < steps.length - 1 && (
              <div style={{ width: 1, flex: 1, minHeight: 10, background: "#e0e0e0", marginTop: 3 }} />
            )}
          </div>
          <div style={{ minWidth: 0, paddingBottom: 2 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: s.status === "running" ? 600 : 400,
                color: s.status === "error" ? "#ff4d4f" : "#333",
                lineHeight: "16px",
              }}
            >
              {s.label}
            </div>
            {s.detail && (
              <div style={{ fontSize: 11, color: "#999", lineHeight: "16px" }}>{s.detail}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
