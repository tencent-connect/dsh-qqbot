------------------------ MODULE QqInteractionLifecycle ------------------------
EXTENDS Naturals

CONSTANTS CheckReceiptOwner, FreshCardToken, CheckSubmission
Requests == 1..2
Steps == 1..2
VARIABLES mode, latest, current, stage, step, flight, sent, retired, answers,
          badAnswer, switched, live

vars == <<mode, latest, current, stage, step, flight, sent, retired, answers,
          badAnswer, switched, live>>

Init ==
  /\ mode \in {"approval", "question"}
  /\ latest = 0 /\ current = 0 /\ stage = "idle"
  /\ step = [r \in Requests |-> 1]
  /\ flight = {} /\ sent = {} /\ retired = {} /\ answers = {}
  /\ badAnswer = FALSE /\ switched = FALSE /\ live = TRUE

RetireCurrent ==
  retired' = IF current = 0 THEN retired ELSE retired \cup {current}

Start ==
  /\ live /\ latest < 2
  /\ latest' = latest + 1 /\ current' = latest + 1 /\ stage' = "sending"
  /\ flight' = flight \cup {<<latest + 1, 1>>}
  /\ RetireCurrent
  /\ UNCHANGED <<mode, step, sent, answers, badAnswer, switched, live>>

Cancel ==
  /\ current # 0
  /\ current' = 0 /\ stage' = "idle" /\ RetireCurrent
  /\ UNCHANGED <<mode, latest, step, flight, sent, answers, badAnswer, switched, live>>

SwitchSession ==
  /\ live /\ ~switched
  /\ switched' = TRUE /\ current' = 0 /\ stage' = "idle" /\ RetireCurrent
  /\ UNCHANGED <<mode, latest, step, flight, sent, answers, badAnswer, live>>

Unload ==
  /\ live
  /\ live' = FALSE /\ current' = 0 /\ stage' = "idle" /\ RetireCurrent
  /\ UNCHANGED <<mode, latest, step, flight, sent, answers, badAnswer, switched>>

Timeout ==
  /\ mode = "question" /\ current # 0
  /\ (stage = "waiting" \/ step[current] = 2)
  /\ current' = 0 /\ stage' = "idle" /\ RetireCurrent
  /\ UNCHANGED <<mode, latest, step, flight, sent, answers, badAnswer, switched, live>>

IsCurrent(r, i) ==
  live /\ current = r /\ stage = "sending" /\ step[r] = i

SendReceipt(r, i) ==
  /\ <<r, i>> \in flight
  /\ flight' = flight \ {<<r, i>>}
  /\ sent' = sent \cup {<<r, i>>}
  /\ IF IsCurrent(r, i) \/ ~CheckReceiptOwner
        THEN /\ current' = r /\ stage' = "waiting"
        ELSE UNCHANGED <<current, stage>>
  /\ UNCHANGED <<mode, latest, step, retired, answers, badAnswer, switched, live>>

SendSkipped(r, i) ==
  \* The transport reports no submission (for example a suppressed duplicate).
  /\ <<r, i>> \in flight
  /\ flight' = flight \ {<<r, i>>}
  /\ IF IsCurrent(r, i)
        THEN IF CheckSubmission
               THEN /\ current' = 0 /\ stage' = "idle" /\ RetireCurrent
               ELSE /\ stage' = "waiting" /\ UNCHANGED <<current, retired>>
        ELSE UNCHANGED <<current, stage, retired>>
  /\ UNCHANGED <<mode, latest, step, sent, answers, badAnswer, switched, live>>

Token(r, i) == <<IF FreshCardToken THEN r ELSE 1, i>>

Click(r, i) ==
  /\ <<r, i>> \in sent
  /\ live /\ current # 0 /\ stage = "waiting"
  /\ Token(r, i) = Token(current, step[current])
  /\ badAnswer' = (badAnswer \/ r # current \/ <<current, step[current]>> \in answers)
  /\ answers' = answers \cup {<<current, step[current]>>}
  /\ IF mode = "question" /\ step[current] = 1
        THEN /\ step' = [step EXCEPT ![current] = 2]
             /\ flight' = flight \cup {<<current, 2>>}
             /\ stage' = "sending" /\ UNCHANGED <<current, retired>>
        ELSE /\ current' = 0 /\ stage' = "idle" /\ RetireCurrent
             /\ UNCHANGED <<step, flight>>
  /\ UNCHANGED <<mode, latest, sent, switched, live>>

Advance ==
  \/ Start \/ Cancel \/ SwitchSession \/ Unload \/ Timeout
  \/ \E r \in Requests, i \in Steps: SendReceipt(r, i) \/ SendSkipped(r, i) \/ Click(r, i)

Quiescent == ~ENABLED Advance /\ UNCHANGED vars
Next == Advance \/ Quiescent
Spec == Init /\ [][Next]_vars

CurrentIsLive == current = 0 \/ (live /\ current = latest /\ current \notin retired)
WaitingHasSentCard == stage # "waiting" \/ (<<current, step[current]>> \in sent)
OnlyCurrentCardAnswersOnce == ~badAnswer
==============================================================================
