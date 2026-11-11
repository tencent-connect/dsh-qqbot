-------------------------- MODULE QqOriginAdmission ---------------------------
EXTENDS Naturals

CONSTANTS CheckAccount, CheckMixed, CheckAdmission, CheckBinding, CheckPeer
Bots == {"A", "B"}
Kinds == {"text", "upload"}
NoJob == [source |-> "", bot |-> "", kind |-> "", turn |-> 0]
VARIABLES registered, claimed, turn, qq, web, admitted, unique, webPolicy,
          job, done, bad, badClaim
vars == <<registered, claimed, turn, qq, web, admitted, unique, webPolicy,
          job, done, bad, badClaim>>

Init ==
  /\ registered = {}
  /\ claimed = [r \in Bots |-> 0]
  /\ turn = [r \in Bots |-> 1]
  /\ qq = {} /\ web = {} /\ admitted = Bots
  /\ unique = TRUE /\ webPolicy \in BOOLEAN
  /\ job = NoJob /\ done = FALSE /\ bad = {} /\ badClaim = FALSE

Receive(r) ==
  \* The two accounts may see exactly the same QQ OpenID and message ID.
  /\ r \in admitted \ registered /\ unique
  /\ registered' = registered \cup {r}
  /\ UNCHANGED <<claimed, turn, qq, web, admitted, unique, webPolicy, job, done, bad, badClaim>>

Claim(r, peerMatches) ==
  \* The message ID and body have matched a receipt in the receiving bot's ledger.
  /\ r \in registered \ qq /\ unique
  /\ claimed[r] \in {0, turn[r]}
  /\ peerMatches \/ ~CheckPeer
  /\ qq' = qq \cup {r}
  /\ claimed' = [claimed EXCEPT ![r] = turn[r]]
  /\ badClaim' = (badClaim \/ ~peerMatches)
  /\ UNCHANGED <<registered, turn, web, admitted, unique, webPolicy, job, done, bad>>

WebInput(r) ==
  /\ r \notin web
  /\ web' = web \cup {r}
  /\ UNCHANGED <<registered, claimed, turn, qq, admitted, unique, webPolicy, job, done, bad, badClaim>>

ReplaceTurn ==
  \* An unfinished turn is replaced; it cannot borrow the new turn's authority.
  /\ turn["A"] = 1
  /\ turn' = [turn EXCEPT !["A"] = 2]
  /\ qq' = qq \ {"A"} /\ web' = web \ {"A"}
  /\ UNCHANGED <<registered, claimed, admitted, unique, webPolicy, job, done, bad, badClaim>>

AmbiguousBinding ==
  /\ unique /\ unique' = FALSE
  /\ UNCHANGED <<registered, claimed, turn, qq, web, admitted, webPolicy, job, done, bad, badClaim>>

Revoke(r) ==
  /\ r \in admitted /\ admitted' = admitted \ {r}
  /\ UNCHANGED <<registered, claimed, turn, qq, web, unique, webPolicy, job, done, bad, badClaim>>

Mixed(r) == r \in qq \cap web

Queue(r, sender, kind) ==
  /\ job = NoJob /\ ~done /\ unique /\ r \in admitted
  /\ ~Mixed(r) /\ (r \in qq \/ (webPolicy /\ r \in web))
  /\ job' = [source |-> r, bot |-> sender, kind |-> kind, turn |-> turn[r]]
  /\ UNCHANGED <<registered, claimed, turn, qq, web, admitted, unique, webPolicy, done, bad, badClaim>>

Post ==
  /\ job # NoJob /\ ~done
  /\ (~CheckAccount \/ job.source = job.bot)
  /\ (~CheckMixed \/ ~Mixed(job.source))
  /\ (~CheckAdmission \/ job.bot \in admitted)
  /\ (~CheckBinding \/ (unique /\ turn[job.source] = job.turn))
  /\ done' = TRUE
  /\ bad' = {label \in {"account", "mixed", "admission", "binding"} :
       \/ (label = "account" /\ job.source # job.bot)
       \/ (label = "mixed" /\ Mixed(job.source))
       \/ (label = "admission" /\ job.bot \notin admitted)
       \/ (label = "binding" /\ (~unique \/ turn[job.source] # job.turn))}
  /\ UNCHANGED <<registered, claimed, turn, qq, web, admitted, unique, webPolicy, job, badClaim>>

Advance ==
  \/ \E r \in Bots: Receive(r) \/ Claim(r, TRUE) \/ Claim(r, FALSE) \/ WebInput(r) \/ Revoke(r)
  \/ \E r \in Bots, sender \in Bots, kind \in Kinds: Queue(r, sender, kind)
  \/ ReplaceTurn \/ AmbiguousBinding \/ Post

Quiescent == ~ENABLED Advance /\ UNCHANGED vars
Next == Advance \/ Quiescent
Spec == Init /\ [][Next]_vars

ClaimStaysInPeer == ~badClaim
PostStaysInAccount == "account" \notin bad
MixedDoesNotPost == "mixed" \notin bad
RevokedDoesNotPost == "admission" \notin bad
PostRequiresCurrentBinding == "binding" \notin bad
==============================================================================
