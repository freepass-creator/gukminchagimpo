# 국민차매매단지 공항점 — 임대관리 시스템

자동차매매단지 운영법인을 위한 임대관리 SaaS. A동·B동의 사무실·주차공간(전시장) 임대·청구·수납·미수·공과금 안분·가용성 추적을 통합 관리.

## 스택

- **Framework**: Next.js 14 (App Router) · React 18 · TypeScript
- **Styling**: Tailwind CSS v3 · Pretendard
- **Backend**: Firebase Auth · Firestore · Storage
- **Icons**: lucide-react
- **Toast**: sonner
- **배포**: Vercel
- **저장소**: github.com/freepass-creator/gukminchagimpo

## 로컬 실행

```bash
npm install
npm run dev
```

`http://localhost:3000` 접속.

처음 실행 시 로그인 → `/api/seed` 호출하면 가상 초기 데이터(A동·B동 공간 36개, 상사 5개, 계약 5건) Firestore에 시드.

## 환경변수

`.env.local`에 Firebase config 입력. `.env.local.example` 참고. Firebase Web App config는 클라이언트에 노출되어도 안전 (보안은 Firestore Rules가 담당).

## 핵심 도메인

- **공간(Stall) 2종**: 사무실 / 주차공간(= 전시장)
- **마스터**: Stall · Tenant · Lease
- **트랜잭션**: Billing · Payment · AuditLog
- **공간 상태 5종 (실시간 자동 산출)**:
  - 공실 / 계약중·정상 / 계약중·연체 / 만료예정 / 입점예정

## 계약 생성 제약

1. 임대 가능 공간 = 등록된 사무실·주차공간만
2. 한 공간 = 같은 기간 1계약. 충돌 시 운영자 선택 (a) 시작일 조정 (b) 기존 중도해지 (c) 메모 강제 등록

## 운영 정책

모든 임계값(만료예정 기준일·연체 시작·납기·청구일·알림 시점·보증금 배수 등)은 단지 관리자 `/settings` 화면에서 조정.

## 화면

| 경로 | 기능 |
|------|------|
| `/dashboard` | KPI 4종 + 만료·입점예정 + 미수 TOP + 단지 미니맵 |
| `/map` | A·B동 사무실+주차 색상 시각화 |
| `/timeline` | 8개월 시간축 가용성 — 언제 비는지 한눈에 |
| `/leases` | 임대 계약 목록·상세·신규·갱신·해지 |
| `/billings` | 월별 청구·수납 그리드 + 정기 청구 일괄 생성 |
| `/tenants` | 입주상사 카드 + 계약·미수 요약 |
| `/settings` | 운영 정책 6분류 |
| `/login` | Firebase 이메일 로그인 |
