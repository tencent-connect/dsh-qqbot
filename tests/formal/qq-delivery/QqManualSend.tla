---------------------------- MODULE QqManualSend ----------------------------
EXTENDS Naturals

CONSTANTS RecheckAtPost, ProtectLedger
VARIABLES stage, receipt, allowed, posts, postedWithoutAccess, ledgerMissing
vars == <<stage, receipt, allowed, posts, postedWithoutAccess, ledgerMissing>>

Init ==
  /\ stage = "idle"
  /\ receipt = "empty"
  /\ allowed = TRUE
  /\ posts = 0
  /\ postedWithoutAccess = FALSE
  /\ ledgerMissing = FALSE

Reserve ==
  /\ stage = "idle" /\ receipt = "empty" /\ allowed
  /\ (~ledgerMissing \/ ~ProtectLedger)
  /\ stage' = "waiting"
  /\ receipt' = "reserved"
  /\ ledgerMissing' = FALSE
  /\ UNCHANGED <<allowed, posts, postedWithoutAccess>>

Revoke ==
  /\ allowed
  /\ allowed' = FALSE
  /\ UNCHANGED <<stage, receipt, posts, postedWithoutAccess, ledgerMissing>>

RestoreAccess ==
  /\ ~allowed
  /\ allowed' = TRUE
  /\ UNCHANGED <<stage, receipt, posts, postedWithoutAccess, ledgerMissing>>

SubmitPost ==
  /\ stage = "waiting" /\ posts < 2
  /\ (allowed \/ ~RecheckAtPost)
  /\ stage' = "posted"
  /\ posts' = posts + 1
  /\ postedWithoutAccess' = (postedWithoutAccess \/ ~allowed)
  /\ UNCHANGED <<receipt, allowed, ledgerMissing>>

BlockPost ==
  /\ stage = "waiting" /\ ~allowed /\ RecheckAtPost
  /\ stage' = "idle"
  /\ receipt' = "rejected"
  /\ UNCHANGED <<allowed, posts, postedWithoutAccess, ledgerMissing>>

AcceptReceipt ==
  /\ stage = "posted"
  /\ stage' = "idle"
  /\ receipt' = "accepted"
  /\ UNCHANGED <<allowed, posts, postedWithoutAccess, ledgerMissing>>

RejectReceipt ==
  /\ stage = "posted"
  /\ stage' = "idle"
  /\ receipt' = "rejected"
  /\ UNCHANGED <<allowed, posts, postedWithoutAccess, ledgerMissing>>

LoseReceipt ==
  /\ stage = "posted"
  /\ stage' = "idle"
  /\ receipt' = "unknown"
  /\ UNCHANGED <<allowed, posts, postedWithoutAccess, ledgerMissing>>

Restart ==
  /\ stage \in {"waiting", "posted"}
  /\ stage' = "idle"
  /\ UNCHANGED <<receipt, allowed, posts, postedWithoutAccess, ledgerMissing>>

ReadExisting ==
  /\ receipt # "empty"
  /\ UNCHANGED vars

LoseLedgerOffline ==
  /\ stage = "idle" /\ receipt # "empty"
  /\ receipt' = "empty"
  /\ ledgerMissing' = TRUE
  /\ UNCHANGED <<stage, allowed, posts, postedWithoutAccess>>

Next ==
  \/ Reserve \/ Revoke \/ RestoreAccess \/ SubmitPost \/ BlockPost
  \/ AcceptReceipt \/ RejectReceipt \/ LoseReceipt \/ Restart
  \/ ReadExisting \/ LoseLedgerOffline

Spec == Init /\ [][Next]_vars

OnlyAuthorizedPost == ~postedWithoutAccess
OnePostPerOperation == posts <= 1
AcceptedRequiresPost == receipt # "accepted" \/ posts > 0
PostFollowsReservation == stage # "posted" \/ receipt = "reserved"
=============================================================================
