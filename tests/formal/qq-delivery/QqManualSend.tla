---------------------------- MODULE QqManualSend ----------------------------
EXTENDS Naturals

CONSTANTS RecheckAtPost, AllowStorageLoss
VARIABLES stage, receipt, allowed, posts, postedWithoutAccess
vars == <<stage, receipt, allowed, posts, postedWithoutAccess>>

Init ==
  /\ stage = "idle"
  /\ receipt = "empty"
  /\ allowed = TRUE
  /\ posts = 0
  /\ postedWithoutAccess = FALSE

Reserve ==
  /\ stage = "idle" /\ receipt = "empty" /\ allowed
  /\ stage' = "waiting"
  /\ receipt' = "reserved"
  /\ UNCHANGED <<allowed, posts, postedWithoutAccess>>

Revoke ==
  /\ allowed
  /\ allowed' = FALSE
  /\ UNCHANGED <<stage, receipt, posts, postedWithoutAccess>>

RestoreAccess ==
  /\ ~allowed
  /\ allowed' = TRUE
  /\ UNCHANGED <<stage, receipt, posts, postedWithoutAccess>>

SubmitPost ==
  /\ stage = "waiting" /\ posts < 2
  /\ (allowed \/ ~RecheckAtPost)
  /\ stage' = "posted"
  /\ posts' = posts + 1
  /\ postedWithoutAccess' = (postedWithoutAccess \/ ~allowed)
  /\ UNCHANGED <<receipt, allowed>>

BlockPost ==
  /\ stage = "waiting" /\ ~allowed /\ RecheckAtPost
  /\ stage' = "idle"
  /\ receipt' = "rejected"
  /\ UNCHANGED <<allowed, posts, postedWithoutAccess>>

AcceptReceipt ==
  /\ stage = "posted"
  /\ stage' = "idle"
  /\ receipt' = "accepted"
  /\ UNCHANGED <<allowed, posts, postedWithoutAccess>>

RejectReceipt ==
  /\ stage = "posted"
  /\ stage' = "idle"
  /\ receipt' = "rejected"
  /\ UNCHANGED <<allowed, posts, postedWithoutAccess>>

LoseReceipt ==
  /\ stage = "posted"
  /\ stage' = "idle"
  /\ receipt' = "unknown"
  /\ UNCHANGED <<allowed, posts, postedWithoutAccess>>

Restart ==
  /\ stage \in {"waiting", "posted"}
  /\ stage' = "idle"
  /\ UNCHANGED <<receipt, allowed, posts, postedWithoutAccess>>

ReadExisting ==
  /\ receipt # "empty"
  /\ UNCHANGED vars

LoseLedgerOffline ==
  /\ AllowStorageLoss /\ stage = "idle" /\ receipt # "empty"
  /\ receipt' = "empty"
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
