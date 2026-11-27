/* 피클 합동 비서실 — 공용 설정
 * 이 파일 하나만 고치면 오피스 전체 설정이 바뀝니다.
 */
window.PJO_CONFIG = {
  // 실시간 백엔드: ntfy.sh (무료 · 가입 없음 · CORS 허용 · curl GET/POST 가능)
  endpoint: "https://ntfy.sh",
  topic: "pickle-office-0d8fdd8ba532",

  // 사람
  people: {
    jin: { key: "jin", name: "진영", mention: "@진영", color: "#3B82F6", glyph: "진" },
    hyun: { key: "hyun", name: "현주", mention: "@현주", color: "#DB2777", glyph: "현" }
  },

  // AI 비서(피클)
  agents: {
    ddak: {
      key: "ddak",
      name: "따까리",
      mention: "@따까리",
      color: "#F2B705",
      ink: "#3D2C00",
      glyph: "ㄷ",
      owner: "진영",
      note: "진영 님의 피클"
    },
    hyeonju: {
      key: "hyeonju",
      name: "현주피클",
      mention: "@현주피클",
      color: "#FF7A59",
      ink: "#41160A",
      glyph: "ㅎ",
      owner: "현주",
      note: "현주 님의 피클"
    }
  },

  rooms: {
    meeting: { key: "meeting", name: "회의실", emoji: "🗣️", status: "회의 중" },
    work: { key: "work", name: "작업실", emoji: "🖥️", status: "작업 중" },
    lounge: { key: "lounge", name: "라운지", emoji: "🛋️", status: "휴식 중" }
  },

  statuses: ["대기 중", "작업 중", "회의 중", "휴식 중", "자리 비움"],

  board: {
    todo: "할 일",
    doing: "진행 중",
    done: "완료"
  }
};
