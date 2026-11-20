--------------------------- MODULE QqStreamFallback ---------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS CheckOpeningId, CheckRateLimitStatus, FenceUnknown
Attempts == 1..2
VARIABLES stage, attempt, wire, static, active, revoked
vars == <<stage, attempt, wire, static, active, revoked>>

Init ==
  /\ stage = "idle"
  /\ attempt = 0
  /\ wire = [i \in Attempts |-> "none"]
  /\ static = FALSE /\ active = TRUE /\ revoked = FALSE

ReserveStream ==
  /\ stage = "idle" /\ ~static /\ active /\ ~revoked
  /\ stage' = "reserved"
  /\ UNCHANGED <<attempt, wire, static, active, revoked>>

ExpireBeforePost ==
  /\ stage = "reserved"
  /\ stage' = "not-sent"
  /\ UNCHANGED <<attempt, wire, static, active, revoked>>

PostOpening ==
  /\ stage \in {"reserved", "rate-limited", "unidentified"}
  /\ active /\ ~revoked /\ ~static /\ attempt < 2
  /\ attempt' = attempt + 1
  /\ wire' = [wire EXCEPT ![attempt + 1] = "in-flight"]
  /\ stage' = "waiting"
  /\ UNCHANGED <<static, active, revoked>>

PlatformAccepts(i) ==
  \* An already-submitted request can take effect after a local timeout.
  /\ wire[i] = "in-flight"
  /\ wire' = [wire EXCEPT ![i] = "accepted"]
  /\ UNCHANGED <<stage, attempt, static, active, revoked>>

OpeningReceipt ==
  /\ stage = "waiting" /\ wire[attempt] = "accepted"
  /\ stage' = "identified"
  /\ UNCHANGED <<attempt, wire, static, active, revoked>>

ReceiptWithoutId ==
  /\ stage = "waiting" /\ wire[attempt] = "accepted"
  /\ stage' = IF CheckOpeningId THEN "unknown" ELSE "unidentified"
  /\ UNCHANGED <<attempt, wire, static, active, revoked>>

Timeout ==
  /\ stage = "waiting"
  /\ stage' = "timed-out"
  /\ UNCHANGED <<attempt, wire, static, active, revoked>>

ConfirmedRateLimit ==
  /\ stage = "waiting" /\ wire[attempt] = "in-flight"
  /\ wire' = [wire EXCEPT ![attempt] = "rejected"]
  /\ stage' = IF attempt < 2 THEN "rate-limited" ELSE "unknown"
  /\ UNCHANGED <<attempt, static, active, revoked>>

AmbiguousRateLimit ==
  \* The business code alone does not prove rejection. The POST can still take effect.
  /\ stage = "waiting"
  /\ stage' = IF ~CheckRateLimitStatus /\ attempt < 2 THEN "rate-limited" ELSE "unknown"
  /\ UNCHANGED <<attempt, wire, static, active, revoked>>

ConfirmedExpiry ==
  /\ stage = "waiting" /\ wire[attempt] = "in-flight"
  /\ wire' = [wire EXCEPT ![attempt] = "rejected"]
  /\ stage' = "not-sent"
  /\ UNCHANGED <<attempt, static, active, revoked>>

FinishIdentified ==
  \* Only the known stream is updated; a failed final frame cannot free the static path.
  /\ stage = "identified" /\ active /\ ~revoked
  /\ stage' \in {"completed", "unknown"}
  /\ UNCHANGED <<attempt, wire, static, active, revoked>>

Revoke ==
  /\ ~revoked /\ revoked' = TRUE
  /\ UNCHANGED <<stage, attempt, wire, static, active>>

Retire ==
  \* A fresh runtime sees the same journal and may ask to send static.
  /\ active /\ active' = FALSE
  /\ UNCHANGED <<stage, attempt, wire, static, revoked>>

SendStatic ==
  /\ ~revoked /\ ~static
  /\ stage \in {"idle", "not-sent"} \/ (~FenceUnknown /\ stage = "timed-out")
  /\ static' = TRUE
  /\ UNCHANGED <<stage, attempt, wire, active, revoked>>

Advance ==
  \/ ReserveStream \/ ExpireBeforePost \/ PostOpening
  \/ \E i \in Attempts : PlatformAccepts(i)
  \/ OpeningReceipt \/ ReceiptWithoutId \/ Timeout
  \/ ConfirmedRateLimit \/ AmbiguousRateLimit \/ ConfirmedExpiry
  \/ FinishIdentified \/ Revoke \/ Retire \/ SendStatic

Quiescent ==
  /\ ~ENABLED Advance
  /\ UNCHANGED vars

Next == Advance \/ Quiescent
Spec == Init /\ [][Next]_vars
AtMostOneReply ==
  Cardinality({i \in Attempts : wire[i] = "accepted"}) + (IF static THEN 1 ELSE 0) <= 1
=============================================================================
