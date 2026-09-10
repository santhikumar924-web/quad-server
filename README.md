# Quad — backend

Real-time matching + chat server for Quad. Node.js, Express, Socket.IO.
The frontend (public/index.html) is served straight from this server —
one process, no separate frontend deploy needed for now.

## Run it

```
npm install
npm start
```

Then open http://localhost:3000 — open it in two different browser
windows (or two devices on the same network) to actually match with
yourself and test the chat.

## How matching works

- Every browser that clicks "find someone to talk to" gets pushed into
  an in-memory waiting queue (`waitingQueue` in server.js).
- As soon as there are 2+ people waiting, the oldest two get paired
  into a private Socket.IO room and both get a `matched` event with
  the other person's chosen username + gender.
- Messages, typing indicators, skip, end, and report all flow as
  Socket.IO events scoped to that pair — nothing is broadcast.
- Skip / end / report / disconnect all funnel through one `endPair()`
  function that tells the other person `partner_left` and cleans up
  both sides' state.
- Reports are logged in-memory (`reports` array) with a timestamp,
  the reporter's and reported person's usernames, and the reason.
  You can eyeball them at http://localhost:3000/__reports while
  testing locally — remove or password-protect that route before
  putting this anywhere public.

## What's still missing before this is a real, shippable product

1. **Actual VIT-AP verification.** Right now anyone can type any
   username — there's no check tying a connection to a real student.
   The lightest fix: an email-OTP step (send a 6-digit code to
   `@vitapstudent.ac.in`, verify before allowing `register`).
2. **Persistence across restarts.** `users`, `waitingQueue`, and
   `reports` all live in memory and vanish on every restart or crash.
   Fine for a prototype, not fine for production — move at least
   `reports` (and probably a ban list) into a real database.
3. **Scaling past one process.** The matching queue only works because
   it's a single in-memory array on a single server process. The
   moment you run more than one instance (which you'll need under
   real load), you need a shared queue — Redis is the standard choice
   — and Socket.IO's Redis adapter so events reach the right server.
4. **Moderation beyond "the two of you disconnect."** Reports are
   logged but nothing acts on them yet. You'll want a way to review
   them and actually ban a username/email after N reports.
5. **Rate limiting / abuse prevention** — nothing currently stops one
   connection from spamming `find_match` or messages.
6. **HTTPS + a real domain** if you deploy this anywhere students can
   reach it, plus environment-based config instead of hardcoded
   `localhost`.
