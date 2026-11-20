------------------------------- MODULE QqPairing -------------------------------
EXTENDS Naturals

CONSTANT KeepFenceOnRestart
VARIABLES issued, active, member, receipts, fenced, revokedCodes, operation, outcome, staleGrant
vars == <<issued, active, member, receipts, fenced, revokedCodes, operation, outcome, staleGrant>>

Codes == 1..2
Idle == [step |-> "idle", code |-> 0]

Init ==
  /\ issued = {}
  /\ active = {}
  /\ member = FALSE
  /\ receipts = {}
  /\ fenced = {}
  /\ revokedCodes = {}
  /\ operation = Idle
  /\ outcome = "none"
  /\ staleGrant = FALSE

\* The member used code 1 successfully. Code 2 is still active and unused.
WitnessInit ==
  /\ issued = Codes
  /\ active = Codes
  /\ member = TRUE
  /\ receipts = {1}
  /\ fenced = {}
  /\ revokedCodes = {}
  /\ operation = Idle
  /\ outcome = "claim-ok"
  /\ staleGrant = FALSE

IssueCode ==
  /\ operation = Idle
  /\ \E code \in (Codes \ issued):
    /\ issued' = issued \cup {code}
    /\ \E replaced \in ({ {} } \cup { {old} : old \in active }):
      /\ active' = (active \ replaced) \cup {code}
      /\ receipts' = receipts \ replaced
      /\ fenced' = fenced \ replaced
  /\ UNCHANGED <<member, revokedCodes, operation, outcome, staleGrant>>

CloseOrExpire ==
  /\ operation = Idle
  /\ \E code \in active:
    /\ active' = active \ {code}
    /\ receipts' = receipts \ {code}
    /\ fenced' = fenced \ {code}
  /\ UNCHANGED <<issued, member, revokedCodes, operation, outcome, staleGrant>>

StartClaim ==
  /\ operation = Idle
  /\ \E code \in (active \ fenced):
    /\ (member \/ code \notin receipts)
    /\ operation' = [step |-> "write-member", code |-> code]
  /\ outcome' = "none"
  /\ UNCHANGED <<issued, active, member, receipts, fenced, revokedCodes, staleGrant>>

PersistMember ==
  /\ operation.step = "write-member"
  /\ member' = TRUE
  /\ staleGrant' = (staleGrant \/ (~member /\ operation.code \in revokedCodes))
  /\ operation' = [operation EXCEPT !.step = "write-result"]
  /\ UNCHANGED <<issued, active, receipts, fenced, revokedCodes, outcome>>

PersistClaimResult ==
  /\ operation.step = "write-result"
  /\ receipts' = receipts \cup {operation.code}
  /\ operation' = Idle
  /\ outcome' = "claim-ok"
  /\ UNCHANGED <<issued, active, member, fenced, revokedCodes, staleGrant>>

StartRevoke ==
  /\ operation = Idle
  /\ operation' = [step |-> "write-fence", code |-> 0]
  /\ outcome' = "none"
  /\ UNCHANGED <<issued, active, member, receipts, fenced, revokedCodes, staleGrant>>

PersistRevocationFence ==
  /\ operation.step = "write-fence"
  /\ fenced' = active
  /\ operation' = [operation EXCEPT !.step = "remove-member"]
  /\ UNCHANGED <<issued, active, member, receipts, revokedCodes, outcome, staleGrant>>

PersistRemoval ==
  /\ operation.step = "remove-member"
  /\ member' = FALSE
  /\ revokedCodes' = revokedCodes \cup active
  /\ operation' = Idle
  /\ outcome' = "revoke-ok"
  /\ UNCHANGED <<issued, active, receipts, fenced, staleGrant>>

WriteFailed ==
  /\ operation # Idle
  /\ operation' = Idle
  /\ outcome' = "write-failed"
  /\ UNCHANGED <<issued, active, member, receipts, fenced, revokedCodes, staleGrant>>

Restart ==
  /\ operation' = Idle
  /\ outcome' = "none"
  /\ fenced' = IF KeepFenceOnRestart THEN fenced ELSE {}
  /\ UNCHANGED <<issued, active, member, receipts, revokedCodes, staleGrant>>

Next ==
  \/ IssueCode \/ CloseOrExpire \/ StartClaim \/ PersistMember \/ PersistClaimResult
  \/ StartRevoke \/ PersistRevocationFence \/ PersistRemoval \/ WriteFailed \/ Restart

Spec == Init /\ [][Next]_vars
WitnessSpec == WitnessInit /\ [][Next]_vars

NoOldCodeReadmission == ~staleGrant
ClaimSuccessHasMember == outcome # "claim-ok" \/ member
RevokeSuccessRemovedMember == outcome # "revoke-ok" \/ ~member
===============================================================================
