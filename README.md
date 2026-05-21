# 창고 물품 관리 대장

Google Apps Script 기반 창고 물품 입출고·대여 관리 앱.

## 설정

`Config.gs` 파일을 직접 만들어야 합니다 (`.gitignore`로 제외되어 있음).

```js
// Config.gs
const APP_TITLE        = '창고 물품 관리 대장';   // 앱 제목
const SHEET_TX         = '거래내역';               // 거래 시트 이름
const SHEET_INV        = '재고현황';               // 재고 시트 이름
const STATUS_UNRETURNED = '미반납';               // 대여 미반납 상태값
const TZ               = 'Asia/Seoul';             // 타임존
const ADMIN_EMAIL      = 'your@email.com';         // 알림 수신 이메일
```

## 배포

1. Google 스프레드시트 생성 → `거래내역`, `재고현황` 시트 추가
2. 확장 프로그램 → Apps Script 에 `Code.gs`, `Config.gs`, `offline.html` 붙여넣기
3. 배포 → 새 배포 → 웹 앱 → 액세스: 본인으로 설정
