---------------------------- MODULE QqToolPolicy ----------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS TrackChildren, FenceDispatch, RequireGuards, FenceNativePermission
Agents == {"root", "child"}
Modes == {"native", "custom", "revoked"}
Phases == {"none", "model", "allowed", "done"}

VARIABLES mode, live, guarded, phase, aborted, aboveCap, invalidated, exposures, effects
vars == <<mode, live, guarded, phase, aborted, aboveCap, invalidated, exposures, effects>>

Init ==
  /\ mode = "native"
  /\ live = {"root"}
  /\ guarded = {}
  /\ phase = [a \in Agents |-> "none"]
  /\ aborted = {}
  /\ aboveCap = {}
  /\ invalidated = {}
  /\ exposures = {}
  /\ effects = {}

Covered(a) == a = "root" \/ TrackChildren
NativeConflict(a) == mode # "native" /\ a \in aboveCap
Allowed(a) == a \notin guarded \/ (mode # "revoked" /\ ~NativeConflict(a))
Pending(a) == phase[a] \in {"model", "allowed"}

Start(a) ==
  /\ a \notin live
  \* The creation listener awaits scoped installation before publishing.
  /\ live' = live \cup {a}
  /\ guarded' = IF mode # "native" /\ Covered(a) THEN guarded \cup {a} ELSE guarded
  /\ UNCHANGED <<mode, phase, aborted, aboveCap, invalidated, exposures, effects>>

End(a) ==
  /\ a \in live
  /\ live' = live \ {a}
  /\ guarded' = guarded \ {a}
  /\ phase' = [phase EXCEPT ![a] = "none"]
  /\ aborted' = aborted \ {a}
  /\ aboveCap' = aboveCap \ {a}
  /\ invalidated' = invalidated \ {a}
  /\ UNCHANGED <<mode, exposures, effects>>

Install(a) ==
  /\ a \in live \ guarded
  /\ Covered(a)
  /\ guarded' = guarded \cup {a}
  /\ UNCHANGED <<mode, live, phase, aborted, aboveCap, invalidated, exposures, effects>>

Save(next) ==
  /\ \/ mode = "native" /\ next \in {"custom", "revoked"}
     \/ mode = "custom" /\ next = "revoked"
  /\ ~RequireGuards \/ \A a \in live : Covered(a) => a \in guarded
  /\ mode' = next
  /\ aborted' = IF FenceDispatch
                 THEN aborted \cup {a \in live : Covered(a) /\ Pending(a)}
                 ELSE aborted
  /\ UNCHANGED <<live, guarded, phase, aboveCap, invalidated, exposures, effects>>

RaiseNativePermission(a) ==
  /\ a \in live \ aboveCap
  /\ aboveCap' = aboveCap \cup {a}
  /\ invalidated' = IF mode # "native" /\ Pending(a) THEN invalidated \cup {a} ELSE invalidated
  /\ aborted' = IF FenceNativePermission /\ a \in guarded /\ a \in invalidated'
                 THEN aborted \cup {a} ELSE aborted
  /\ UNCHANGED <<mode, live, guarded, phase, exposures, effects>>

RestoreNativePermission(a) ==
  /\ a \in aboveCap
  /\ aboveCap' = aboveCap \ {a}
  /\ UNCHANGED <<mode, live, guarded, phase, aborted, invalidated, exposures, effects>>

Request(a) ==
  /\ a \in live /\ ~Pending(a)
  /\ phase' = [phase EXCEPT ![a] = "model"]
  /\ exposures' = IF Allowed(a) THEN exposures \cup {<<a, mode, NativeConflict(a)>>} ELSE exposures
  /\ aborted' = aborted \ {a}
  /\ invalidated' = invalidated \ {a}
  /\ UNCHANGED <<mode, live, guarded, aboveCap, effects>>

Check(a) ==
  /\ phase[a] = "model"
  \* A malicious or outdated response can request write regardless of its schema.
  /\ phase' = [phase EXCEPT ![a] = IF a \notin aborted /\ Allowed(a) THEN "allowed" ELSE "done"]
  /\ UNCHANGED <<mode, live, guarded, aborted, aboveCap, invalidated, exposures, effects>>

Dispatch(a) ==
  /\ phase[a] = "allowed"
  /\ phase' = [phase EXCEPT ![a] = "done"]
  /\ effects' = IF a \in aborted THEN effects ELSE effects \cup {<<a, mode, NativeConflict(a) \/ a \in invalidated>>}
  /\ UNCHANGED <<mode, live, guarded, aborted, aboveCap, invalidated, exposures>>

Next ==
  \/ \E a \in Agents : Start(a) \/ End(a) \/ Install(a) \/ Request(a) \/ Check(a) \/ Dispatch(a)
                     \/ RaiseNativePermission(a) \/ RestoreNativePermission(a)
  \/ \E next \in Modes : Save(next)

Spec == Init /\ [][Next]_vars

TypeOK == mode \in Modes /\ live \subseteq Agents /\ guarded \subseteq live
  /\ phase \in [Agents -> Phases] /\ aborted \subseteq live
  /\ aboveCap \subseteq live /\ invalidated \subseteq live
  /\ exposures \subseteq (Agents \X Modes \X BOOLEAN)
  /\ effects \subseteq (Agents \X Modes \X BOOLEAN)
InstalledBeforePublication == mode # "native" => live \subseteq guarded
NoSchemaAfterRevocation == \A a \in Agents, b \in BOOLEAN : <<a, "revoked", b>> \notin exposures
NoSideEffectAfterRevocation == \A a \in Agents, b \in BOOLEAN : <<a, "revoked", b>> \notin effects
NoSchemaAboveNativeCap == \A e \in exposures : ~e[3]
NoSideEffectAfterNativeConflict == \A e \in effects : ~e[3]

=============================================================================
