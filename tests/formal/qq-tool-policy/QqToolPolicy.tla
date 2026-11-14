---------------------------- MODULE QqToolPolicy ----------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS TrackChildren, FenceDispatch, RequireGuards
Agents == {"root", "child"}
Modes == {"native", "custom", "revoked"}
Phases == {"none", "model", "allowed", "done"}

VARIABLES mode, live, guarded, phase, aborted, exposures, effects
vars == <<mode, live, guarded, phase, aborted, exposures, effects>>

Init ==
  /\ mode = "native"
  /\ live = {"root"}
  /\ guarded = {}
  /\ phase = [a \in Agents |-> "none"]
  /\ aborted = {}
  /\ exposures = {}
  /\ effects = {}

Covered(a) == a = "root" \/ TrackChildren
Allowed(a) == mode # "revoked" \/ a \notin guarded
Described(a) == mode # "revoked" \/ a \notin guarded
Pending(a) == phase[a] \in {"model", "allowed"}

Start(a) ==
  /\ a \notin live
  \* The creation listener awaits scoped installation before publishing.
  /\ live' = live \cup {a}
  /\ guarded' = IF mode # "native" /\ Covered(a) THEN guarded \cup {a} ELSE guarded
  /\ UNCHANGED <<mode, phase, aborted, exposures, effects>>

End(a) ==
  /\ a \in live
  /\ live' = live \ {a}
  /\ guarded' = guarded \ {a}
  /\ phase' = [phase EXCEPT ![a] = "none"]
  /\ aborted' = aborted \ {a}
  /\ UNCHANGED <<mode, exposures, effects>>

Install(a) ==
  /\ a \in live \ guarded
  /\ Covered(a)
  /\ guarded' = guarded \cup {a}
  /\ UNCHANGED <<mode, live, phase, aborted, exposures, effects>>

Save(next) ==
  /\ \/ mode = "native" /\ next \in {"custom", "revoked"}
     \/ mode = "custom" /\ next = "revoked"
  /\ ~RequireGuards \/ \A a \in live : Covered(a) => a \in guarded
  /\ mode' = next
  /\ aborted' = IF FenceDispatch /\ next = "revoked"
                 THEN aborted \cup {a \in live : Covered(a) /\ Pending(a)}
                 ELSE aborted
  /\ UNCHANGED <<live, guarded, phase, exposures, effects>>

Request(a) ==
  /\ a \in live /\ ~Pending(a)
  /\ phase' = [phase EXCEPT ![a] = "model"]
  /\ exposures' = IF Described(a) THEN exposures \cup {<<a, mode>>} ELSE exposures
  /\ aborted' = aborted \ {a}
  /\ UNCHANGED <<mode, live, guarded, effects>>

Check(a) ==
  /\ phase[a] = "model"
  \* A malicious or outdated response can request write regardless of its schema.
  /\ phase' = [phase EXCEPT ![a] = IF a \notin aborted /\ Allowed(a) THEN "allowed" ELSE "done"]
  /\ UNCHANGED <<mode, live, guarded, aborted, exposures, effects>>

Dispatch(a) ==
  /\ phase[a] = "allowed"
  /\ phase' = [phase EXCEPT ![a] = "done"]
  /\ effects' = IF a \in aborted THEN effects ELSE effects \cup {<<a, mode>>}
  /\ UNCHANGED <<mode, live, guarded, aborted, exposures>>

Next ==
  \/ \E a \in Agents : Start(a) \/ End(a) \/ Install(a) \/ Request(a) \/ Check(a) \/ Dispatch(a)
  \/ \E next \in Modes : Save(next)

Spec == Init /\ [][Next]_vars

TypeOK == mode \in Modes /\ live \subseteq Agents /\ guarded \subseteq live
  /\ phase \in [Agents -> Phases] /\ aborted \subseteq live
  /\ exposures \subseteq (Agents \X Modes) /\ effects \subseteq (Agents \X Modes)
InstalledBeforePublication == mode # "native" => live \subseteq guarded
NoSchemaAfterRevocation == \A a \in Agents : <<a, "revoked">> \notin exposures
NoSideEffectAfterRevocation == \A a \in Agents : <<a, "revoked">> \notin effects

=============================================================================
