-------------------------- MODULE QqSessionSwitch --------------------------
EXTENDS Naturals

CONSTANTS GuardBinding, GuardRuntime
VARIABLES current, live, saved, epoch, oldView, revision, resetUsed, web, inbound,
          staleBinding, retiredCommit
vars == <<current, live, saved, epoch, oldView, revision, resetUsed, web, inbound,
          staleBinding, retiredCommit>>

IdleWeb == [stage |-> "idle", epoch |-> 0, binding |-> "none", revision |-> 0]
IdleInbound == [stage |-> "idle", epoch |-> 0, binding |-> "none"]
WebBusy == web.epoch = epoch /\ web.stage \in {"creating", "saved"}
InboundBusy == inbound.epoch = epoch /\ inbound.stage # "idle"
InboundView == IF inbound.epoch = epoch THEN current ELSE oldView

Init ==
  /\ current = "original"
  /\ live = "none"
  /\ saved = {"original"}
  /\ epoch = 0
  /\ oldView = "original"
  /\ revision = 0
  /\ resetUsed = FALSE
  /\ web = IdleWeb
  /\ inbound = IdleInbound
  /\ staleBinding = FALSE
  /\ retiredCommit = FALSE

StartInbound ==
  /\ inbound = IdleInbound /\ ~WebBusy
  /\ inbound' = [stage |-> "opening", epoch |-> epoch, binding |-> current]
  /\ UNCHANGED <<current, live, saved, epoch, oldView, revision, resetUsed, web,
                 staleBinding, retiredCommit>>

HostOpensInbound ==
  /\ inbound.stage = "opening"
  /\ inbound' = [inbound EXCEPT !.stage = "ready"]
  /\ saved' = saved \cup {inbound.binding}
  /\ UNCHANGED <<current, live, epoch, oldView, revision, resetUsed, web,
                 staleBinding, retiredCommit>>

PublishInbound ==
  /\ inbound.stage = "ready"
  /\ (~GuardBinding \/ inbound.binding = InboundView)
  /\ (~GuardRuntime \/ inbound.epoch = epoch)
  /\ current' = inbound.binding
  /\ live' = IF inbound.epoch = epoch THEN inbound.binding ELSE live
  /\ staleBinding' = (staleBinding \/ (inbound.epoch = epoch /\ current # inbound.binding))
  /\ retiredCommit' = (retiredCommit \/ (inbound.epoch # epoch))
  /\ inbound' = IdleInbound
  /\ UNCHANGED <<saved, epoch, oldView, revision, resetUsed, web>>

DiscardInbound ==
  /\ inbound.stage # "idle"
  /\ inbound' = IdleInbound
  /\ UNCHANGED <<current, live, saved, epoch, oldView, revision, resetUsed, web,
                 staleBinding, retiredCommit>>

ResetInQQ ==
  /\ ~resetUsed /\ ~WebBusy
  /\ current' = "qq"
  /\ live' = "none"
  /\ resetUsed' = TRUE
  /\ UNCHANGED <<saved, epoch, oldView, revision, web, inbound, staleBinding,
                 retiredCommit>>

StartWeb ==
  /\ web = IdleWeb /\ ~InboundBusy /\ "web" \notin saved
  /\ web' = [stage |-> "creating", epoch |-> epoch, binding |-> current, revision |-> revision]
  /\ UNCHANGED <<current, live, saved, epoch, oldView, revision, resetUsed, inbound,
                 staleBinding, retiredCommit>>

HostSavesWeb ==
  /\ web.stage = "creating"
  /\ web' = [web EXCEPT !.stage = "saved"]
  /\ saved' = saved \cup {"web"}
  /\ UNCHANGED <<current, live, epoch, oldView, revision, resetUsed, inbound,
                 staleBinding, retiredCommit>>

CommitWeb ==
  /\ web.stage = "saved"
  /\ web.epoch = epoch /\ web.binding = current /\ web.revision = revision
  /\ current' = "web"
  /\ live' = "web"
  /\ web' = [web EXCEPT !.stage = "cleanup"]
  /\ UNCHANGED <<saved, epoch, oldView, revision, resetUsed, inbound, staleBinding,
                 retiredCommit>>

FinishWeb ==
  \* Includes host creation or preference write failure, and success or failure of old handle cleanup.
  /\ web.stage # "idle"
  /\ web' = IdleWeb
  /\ UNCHANGED <<current, live, saved, epoch, oldView, revision, resetUsed, inbound,
                 staleBinding, retiredCommit>>

EditSettings ==
  /\ revision = 0
  /\ revision' = 1
  /\ UNCHANGED <<current, live, saved, epoch, oldView, resetUsed, web, inbound,
                 staleBinding, retiredCommit>>

Reload ==
  /\ epoch = 0
  /\ epoch' = 1
  /\ oldView' = current
  /\ live' = "none"
  /\ UNCHANGED <<current, saved, revision, resetUsed, web, inbound, staleBinding,
                 retiredCommit>>

Next ==
  \/ StartInbound \/ ResetInQQ \/ Reload
  \/ HostOpensInbound \/ PublishInbound \/ DiscardInbound
  \/ StartWeb \/ HostSavesWeb \/ CommitWeb \/ FinishWeb \/ EditSettings

Spec == Init /\ [][Next]_vars
NoStaleBindingCommit == ~staleBinding
NoRetiredRuntimeCommit == ~retiredCommit
LiveMatchesBinding == live = "none" \/ (live = current /\ live \in saved)
==============================================================================
