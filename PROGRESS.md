# PROGRESS.md — 창고 물품 관리 대장

## 상태: 구현 완료 / SYNC_URL 설정 후 배포 가능

---

## 최종 아키텍처

```
창고DB.csv (로컬 파일)       ← 주 DB (파일로 직접 저장, 엑셀에서 열기 가능)
        │
        │  기록할 때마다 자동 저장
        │  인터넷 될 때 자동 전송 시도
        ▼
Code.gs doPost + Google Sheets   ← 온라인 백업 + 메일 알림
```

- **로컬 DB**: CSV 파일. 인터넷 없어도 전체 동작. File System Access API로 읽기/쓰기
- **온라인 DB**: 백업 + 메일 알림 용. 전송 실패해도 다음 기록 때 재시도 (synced 플래그)

---

## 파일 목록

| 파일 | 역할 |
|---|---|
| `offline.html` | 태블릿 앱 본체 — 브라우저로 직접 열어서 사용 |
| `Config.gs` | Apps Script 설정 (이메일, 시트명 등) |
| `Code.gs` | 서버 로직 — Sheets 기록 + 메일 발송 + doPost |
| `창고DB.csv` | 로컬 데이터 파일 (앱이 자동 생성/관리) |

---

## offline.html 동작 방식

| 상황 | 동작 |
|---|---|
| 처음 실행 | "새 파일"로 창고DB.csv 위치 지정 |
| 이후 실행 | "이어서 열기" 한 번 탭 → 자동 로드 |
| 입고/출고/대여/반납 기록 | CSV 즉시 저장 + 서버 전송 시도 |
| 인터넷 없을 때 | CSV만 저장, synced=false 유지 |
| 다음 기록 시 (인터넷 됨) | synced=false 항목 모두 전송 |
| 서버 전송 성공 | Sheets 기록 + 메일 발송 + synced=true |

---

## CSV 컬럼 구조

| 날짜시각 | 구분 | 물품명 | 수량 | 담당자 | 대여자 | 반납예정일 | 메모 | 동기화 |

- 구분: `입고` `출고` `대여` `반납` 네 가지
- 엑셀에서 직접 수정 가능 (열 순서 유지 필수)
- 재고는 앱 로드 시 CSV 전체를 재계산해서 산출

---

## 반납 방식

대여 목록 UI 없음 — 반납도 폼 직접 입력:
- 물품명 / 수량 / 담당자 / 반납자

---

## 설정 필요 항목 (배포 전)

| 항목 | 위치 | 내용 |
|---|---|---|
| `SYNC_URL` | `offline.html` 상단 | Apps Script 배포 URL 입력 |
| `ADMIN_EMAIL` | `Config.gs` | 알림 메일 수신 주소 (현재: krjiseop@gmail.com) |

---

## Apps Script 배포 절차

1. [sheets.google.com](https://sheets.google.com) → 새 스프레드시트 생성
2. 시트 이름: `거래내역`, `재고현황`
3. 확장 프로그램 → Apps Script
4. `Config.gs` 파일 생성 후 내용 붙여넣기
5. `Code.gs` 내용 교체 붙여넣기
6. 배포 → 새 배포 → 웹 앱 (실행: 나 / 액세스: 모든 사용자)
7. 권한 승인 → 배포 URL 복사
8. `offline.html` 상단 `SYNC_URL`에 붙여넣기

---

## 변경 이력

### v1 — 기본 구현
- Google Apps Script 웹앱 (index.html + Code.gs)
- 입고/출고/대여/반납, 재고 자동 계산, 메일 알림

### v2 — 개선
- XSS 방어, 상수 분리(Config.gs), API 최적화, 중복 코드 제거

### v3 — 오프라인 전략 확정
- offline.html 단독 파일로 분리, localStorage 기반

### v4 — 반납 UI 단순화
- 대여 목록 조회 제거 → 반납도 폼 직접 입력

### v5 — CSV 파일 기반으로 전환 (최종)
- localStorage 제거
- File System Access API로 창고DB.csv 직접 읽기/쓰기
- 기록할 때마다 CSV 자동 저장
- 물품명 자동완성(datalist) 추가
- CSV 컬럼 한글화
