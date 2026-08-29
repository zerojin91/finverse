// 차트에서 쓰는 색.
//
// 한국 증권 관례를 따른다.  사는 것과 오르는 것이 빨강, 파는 것과 내리는 것이
// 파랑이다(app/globals.css 의 --up / --down 과 같은 값).  마커 색을 파일마다
// 직접 적어두면 한쪽만 고쳐져 매도와 매수가 뒤바뀐 채로 남는다.
//
// 경로 선은 등락이 아니라 "누구의 경로냐"를 뜻하므로 빨강·파랑을 쓰지 않는다.
// 그래야 선 위에 찍히는 매매 마커가 선에 묻히지 않는다.

/** 매도 시점 */
export const SELL_COLOR = "#2563eb";
/** 매수·재진입 시점 */
export const BUY_COLOR = "#ef4444";
/** 손대지 않았을 때의 경로 */
export const HOLD_LINE = "#111113";
/** 내 성향대로 움직였을 때의 경로 */
export const MINE_LINE = "#7c3aed";
/** 비교용 지수 */
export const INDEX_LINE = "#d4d4d8";
