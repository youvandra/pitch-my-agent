# Registering Pitch My Agent on OKX.ai

Run these yourself — `create` and `activate` mint a public identity under your
wallet, and `upload` publishes the avatar to OKX's CDN.

Prerequisite already verified: `agent pre-check --role asp` returns
`canCreate: true` with no `consentKey`, because the wallet
(`0xe3d2…95ac`) has already accepted the terms for its four existing ASPs.

---

## 1. Upload the avatar

Returns a CDN URL. Copy it — step 2 needs it.

```bash
onchainos agent upload --file ~/Documents/pitch-my-agent/assets/avatar.png
```

## 2. Create the agent

Paste the URL from step 1 into `--picture`.

```bash
onchainos agent create \
  --role asp \
  --name "Pitch My Agent" \
  --picture "<CDN_URL_DARI_STEP_1>" \
  --description "Turns any agent on the OKX.ai marketplace into a narrated 1080p demo video. Give it an agent ID and it reads that agent's public profile, services and prices, pulls two brand colours out of its logo, writes the script and narration, and renders a finished mp4 — no assets or brief needed. The output is not a recoloured template: each scene role has several designed compositions and the architecture is chosen per agent, so two agents never get the same video. The centre scene stages one x402 purchase end to end, carrying that service's real fee. Free tools let you preview the script and palette before paying, poll a render, and re-run a failed one at no cost." \
  --service '[{"serviceName":"Animated Pitch","serviceDescription":"A narrated 1080p demo video for one OKX.ai agent, built from its own listing: brand palette extracted from its logo under a contrast contract, per-agent scene architecture, narration with burned-in captions, and a licensed soundtrack every cut is quantised to. Runs roughly 45-70 seconds. Returns a jobId immediately — poll the free get_job tool for the finished video, typically within 7 minutes. Payment settles when the job is accepted; a failed render can be re-run free with retry_job.","serviceType":"A2MCP","fee":"0.4","endpoint":"https://pitchokxai.web.id/pitch/animated"}]'
```

## 3. Activate

Use the `agentId` returned by step 2.

```bash
onchainos agent activate --agent-id <AGENT_ID> --preferred-language en
```

## 4. Verify it took

```bash
onchainos agent service-list --agent-id <AGENT_ID>
```

Check three things in the output: `serviceType` is `A2MCP`, `fee` is `0.4`, and
`endpoint` is the https URL above. The marketplace validator will probe that
endpoint with a bare `GET`, which already answers `402` with the challenge —
verified live.

---

## After registration

Fill the new agent ID into:

- `docs/DRAFT_SUBMISSION.md` — the **Agent ID** field and the X post template
- `frontend/index.html` — footer, so the landing page names the agent it is

Then the remaining blanks in the submission draft are the X handle, the Telegram
handle, and the X post link.
