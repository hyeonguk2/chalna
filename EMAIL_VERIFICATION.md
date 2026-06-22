# 이메일 인증 기능

## 현재 구현

회원가입은 이메일 인증이 완료된 경우에만 허용한다. 인증번호와 인증 완료 상태는 MySQL의 `email_verifications` 테이블에 저장되므로, 백엔드를 재시작해도 인증 유효 시간이 남아 있으면 상태가 유지된다.

인증번호는 6자리이며 발급 후 3분 동안 유효하다. 재발송 시 기존 인증번호는 즉시 무효화되고 새 인증번호와 새 만료 시각으로 교체된다.

## 관련 파일

- `backend/server.js`
  - 이메일 발송, 인증번호 확인, 회원가입 API
  - `users`, `email_verifications` 테이블 자동 생성 및 마이그레이션
  - 인증번호 재발송 서버 제한
- `frontend/src/Signup.jsx`
  - 인증번호 요청 및 확인 UI
  - 3분 인증 만료 표시
  - 30초 재전송 대기 UI
- `backend/.env`
  - 로컬 MySQL 및 SMTP 설정

## DB 저장 흐름

`인증번호 받기` 요청이 성공하면 `email_verifications`에 다음 데이터가 저장된다.

| 컬럼 | 용도 |
| --- | --- |
| `email` | 인증 대상 이메일 (기본 키) |
| `code` | 현재 유효한 6자리 인증번호 |
| `expires_at` | 인증번호 만료 시각 (Unix epoch 밀리초) |
| `last_sent_at` | 마지막 발송 시각 (Unix epoch 밀리초) |
| `verified` | 인증 완료 여부 |

올바른 인증번호를 확인하면 `verified`가 `true`가 된다. 이후 가입 API가 만료 전인지와 `verified` 상태를 확인한다. 가입 성공 또는 만료된 인증번호 확인 시 해당 인증 데이터는 삭제된다.

## API

### 인증번호 전송

```http
POST /send-email-code
Content-Type: application/json

{
  "email": "user@example.com"
}
```

- 이메일 형식 검사
- 6자리 인증번호 생성 및 DB 저장
- SMTP를 통해 이메일 발송
- 인증번호 유효 시간: 3분
- 동일 이메일 재발송 제한: 30초

성공 응답:

```text
sent
```

주요 실패 응답:

```text
invalid email
email config missing
email send error
db error
```

30초 안에 재요청하면 HTTP `429`와 다음 JSON이 반환된다.

```json
{
  "error": "resend too soon",
  "retryAfter": 23
}
```

### 인증번호 확인

```http
POST /verify-email-code
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456"
}
```

DB의 인증번호와 만료 시각을 확인한다. 인증번호가 일치하면 `verified`를 `true`로 변경한다.

성공 응답:

```text
verified
```

주요 실패 응답:

```text
invalid code
expired
db error
```

### 회원가입

```http
POST /signup
Content-Type: application/json

{
  "userid": "testuser",
  "email": "user@example.com",
  "password": "password"
}
```

만료되지 않은 인증 완료 상태가 있어야 `users` 테이블에 가입 정보가 저장된다.

성공 응답:

```text
success
```

주요 실패 응답:

```text
missing fields
email not verified
duplicate
db error
```

## 프론트엔드 동작

1. 인증번호 발송 전에는 `인증번호 받기` 버튼을 표시한다.
2. 발송 후 30초 동안 `인증번호 재전송 (0:30)` 버튼을 비활성화한다.
3. 30초가 지나면 `인증번호 재전송` 버튼이 활성화된다.
4. 재발송하면 새 코드만 유효하며, 3분 타이머도 다시 시작한다.
5. 인증 완료 후에는 발송 버튼 대신 `인증 완료` 상태를 표시한다.
6. 이메일을 변경하면 인증 상태와 타이머를 초기화한다.

## 환경변수

`backend/.env`를 만들고 아래 값을 설정한다.

```env
PORT=3001

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your-db-password
DB_NAME=chalna

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-google-app-password
MAIL_FROM=your-email@gmail.com
```

Gmail SMTP에는 일반 로그인 비밀번호가 아니라, 2단계 인증 후 발급한 16자리 앱 비밀번호를 `SMTP_PASS`에 사용한다.

## 실행 및 테스트

```powershell
cd backend
npm install
npm start
```

백엔드 시작 로그에 아래가 표시되면 DB 준비가 완료된 상태다.

```text
mysql connected
users table ready
email verifications table ready
```

다른 터미널에서 프론트엔드를 실행한다.

```powershell
cd frontend
npm install
npm run dev
```

`http://127.0.0.1:5173/signup`에서 다음을 확인한다.

1. 이메일 인증번호 발송
2. 30초 재전송 제한과 카운트다운
3. 올바른 코드 인증과 만료/오입력 처리
4. 인증된 이메일로 회원가입
5. `users` 테이블의 가입 정보 및 가입 후 인증 행 삭제

## 주의사항

- `.env`는 Git에 올리지 않는다.
- 인증번호와 사용자 비밀번호가 현재 평문으로 저장된다. 운영 환경에서는 인증번호 해시, 비밀번호 `bcrypt` 해시, 발송/입력 횟수 제한을 추가해야 한다.
- 이메일 인증 검증은 반드시 백엔드에서 수행해야 한다. 프론트엔드 상태만으로 가입을 허용하면 브라우저 요청을 조작할 수 있다.
