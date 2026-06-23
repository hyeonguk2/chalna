# 로그인 구현 문서

## 구성

로그인 API는 `POST /api/login`이며, 프런트엔드의 홈 화면 로그인 폼에서 호출한다.

1. 사용자가 아이디와 비밀번호를 입력한다.
2. CAPTCHA 인증과 마우스 이동 데이터가 함께 전송된다.
3. 서버는 잠금 상태, 비밀번호, CAPTCHA, 봇 행동을 순서대로 검증한다.
4. 성공하면 Redis에 세션을 만들고 `sid` HTTP-only 쿠키를 응답한다.
5. 프런트엔드는 `GET /api/me`로 세션을 재확인한 뒤 로그인 상태를 표시한다.

## 관련 파일

- `frontend/src/Home.jsx`: 로그인 폼, CAPTCHA 처리, 세션 상태 표시
- `backend/routes/mousebehavior.js`: 로그인, 세션 조회, 로그아웃 API
- `backend/server.js`: 회원가입과 비밀번호 해시 저장

## API

### `POST /api/login`

요청 예시:

```json
{
  "username": "example-user",
  "password": "password",
  "behaviorMetrics": {
    "mouseTrajectory": [{ "x": 100, "y": 200, "t": 1710000000000 }],
    "clickData": []
  },
  "captchaData": {
    "answer": true
  }
}
```

처리 순서:

1. 아이디와 비밀번호 필수값을 확인한다.
2. `users.login_attempts`와 `lockout_time`으로 잠금 상태를 확인한다. 실패가 2회 이상이면 3분 동안 로그인을 막는다.
3. 아이디로 사용자를 조회한다.
4. `bcryptjs.compare()`로 입력 비밀번호와 DB 해시를 비교한다.
5. CAPTCHA 통과 여부와 행동 기반 봇 탐지 결과를 확인한다.
6. 성공 시 Redis에 24시간짜리 세션을 저장하고 `sid` 쿠키를 발급한다.
7. 성공하면 실패 횟수와 잠금 정보를 초기화한다.

성공 응답 예시:

```json
{
  "success": true,
  "isBot": false,
  "message": "로그인 및 인증 성공"
}
```

### `GET /api/me`

`sid` 쿠키로 Redis 세션을 조회한다. 유효하면 다음 정보를 반환한다.

```json
{
  "authenticated": true,
  "user": {
    "id": 1,
    "userid": "example-user",
    "email": "user@example.com"
  }
}
```

### `POST /api/logout`

Redis 세션을 삭제하고 `sid` 쿠키를 만료시킨다.

## 비밀번호 처리

회원가입 시 `bcryptjs.hash(password, 12)`로 비밀번호를 해시한 뒤 `users.password`에 저장한다. 평문 비밀번호를 새로 저장하지 않는다.

기존에 평문으로 저장된 계정은 로그인 검증에 성공한 경우 해시 값으로 자동 전환한다. 전환 이후에는 bcrypt 비교만 사용된다.

## 프런트엔드 동작

홈 화면 로그인 폼은 `credentials: "include"`로 쿠키를 포함해 요청한다. 서버가 `isBot: true`를 반환하면 로그인 성공으로 처리하지 않는다. 로그인 API가 성공하더라도 `/api/me` 세션 확인에 실패하면 화면의 로그인 상태를 변경하지 않는다.

## 실행 전제

- MySQL: `users` 테이블과 이메일 인증 테이블을 사용한다.
- Redis: 세션 저장소로 사용한다. 기본 주소는 `redis://localhost:6379`이며 `REDIS_URL` 환경 변수로 변경할 수 있다.
- 백엔드: `backend`에서 `npm.cmd start`
- 프런트엔드: `frontend`에서 `npm.cmd run dev`

## 확인 절차

1. 이메일 인증을 완료하고 회원가입한다.
2. 홈 화면에서 아이디와 비밀번호를 입력한다.
3. CAPTCHA를 통과한 후 로그인한다.
4. 사용자 아이디와 로그아웃 버튼이 표시되는지 확인한다.
5. 새로고침 후에도 세션이 유지되는지 확인한다.
6. 로그아웃 후 로그인 UI가 다시 표시되는지 확인한다.
