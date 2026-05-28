# 이메일 인증 기능 정리

## 현재 구현 상태

회원가입 이메일 인증은 실제 백엔드 검증 방식으로 구현되어 있다.

프론트엔드에서 인증번호 요청과 확인을 호출하고, 백엔드는 이메일로 인증번호를 발송한 뒤 서버에 저장된 인증번호와 비교한다. 회원가입 API는 이메일 인증이 완료된 경우에만 가입을 허용한다.

## 수정된 파일

- `backend/server.js`
  - 인증번호 이메일 발송 API 추가
  - 인증번호 확인 API 추가
  - 회원가입 시 이메일 인증 여부 검사 추가
- `frontend/src/Signup.jsx`
  - 기존 임시 인증 UI 로직 제거
  - 백엔드 인증 API 호출 연결
  - 이메일 변경 시 인증 상태 초기화
- `backend/package.json`
  - `nodemailer` 의존성 추가
- `backend/.env.example`
  - SMTP 설정 예시 추가

## API 흐름

### 1. 인증번호 전송

```http
POST /send-email-code
Content-Type: application/json

{
  "email": "user@example.com"
}
```

동작:

- 이메일 형식 검사
- 6자리 인증번호 생성
- 서버 메모리에 인증번호 저장
- SMTP로 인증번호 이메일 발송
- 인증번호 유효 시간은 3분

성공 응답:

```text
sent
```

주요 실패 응답:

```text
invalid email
email config missing
email send error
```

### 2. 인증번호 확인

```http
POST /verify-email-code
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456"
}
```

동작:

- 서버에 저장된 인증번호 조회
- 만료 여부 확인
- 입력한 인증번호와 서버 인증번호 비교
- 일치하면 해당 이메일을 인증 완료 상태로 변경

성공 응답:

```text
verified
```

주요 실패 응답:

```text
invalid code
expired
```

### 3. 회원가입

```http
POST /signup
Content-Type: application/json

{
  "userid": "testuser",
  "email": "user@example.com",
  "password": "password"
}
```

동작:

- 아이디, 이메일, 비밀번호 입력 여부 확인
- 이메일 인증 완료 여부 확인
- 인증되지 않은 이메일이면 가입 차단
- 가입 성공 시 인증 상태 삭제

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

## 환경변수 설정

실제 이메일을 보내려면 `backend/.env`에 SMTP 설정을 채워야 한다.

Gmail 예시:

```env
PORT=3001
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=root
DB_NAME=project

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
MAIL_FROM=your-email@gmail.com
```

`SMTP_PASS`에는 Gmail 로그인 비밀번호가 아니라 Google 계정에서 발급한 앱 비밀번호를 넣어야 한다.

## Gmail 앱 비밀번호 사용 조건

Gmail SMTP를 쓰려면 Google 계정에서 2단계 인증을 켠 뒤 앱 비밀번호를 발급해야 한다.

절차:

1. Google 계정 관리로 이동
2. 보안 메뉴에서 2단계 인증 활성화
3. 앱 비밀번호 생성
4. 생성된 16자리 비밀번호를 `SMTP_PASS`에 입력

## 실행 방법

백엔드:

```bash
cd backend
npm start
```

프론트엔드:

```bash
cd frontend
npm run dev
```

기본 주소:

- 프론트엔드: `http://127.0.0.1:5173`
- 백엔드: `http://localhost:3001`

## 주의사항

- 인증번호는 현재 서버 메모리에 저장된다.
- 서버를 재시작하면 기존 인증번호는 사라진다.
- 운영 환경에서는 Redis나 DB에 인증번호를 저장하는 방식이 더 적합하다.
- 현재 비밀번호는 평문으로 DB에 저장된다. 실제 서비스에서는 `bcrypt` 같은 해시 처리가 필요하다.
- 이메일 인증 검증은 프론트엔드가 아니라 백엔드에서 처리해야 한다. 사용자가 브라우저 코드를 조작할 수 있기 때문이다.

## 테스트한 항목

- `node --check server.js`
- `npm.cmd run build`
- 백엔드 `3001` 포트 실행 확인
- 프론트엔드 `5173` 포트 응답 확인
