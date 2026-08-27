# Challenge case

Use these files to regression-test the difficult paths:

- Question Paper: `question-paper/challenge-question-paper.pdf` (2 pages)
- Answer Sheet: `answer-sheet/challenge-answer-sheet.pdf` (3 pages)

This case includes out-of-order labeled answers, `5(a)` / `5(b)` subparts, an unanswered Q8, a drawn labelled diagram for Q9, an unmatched `Ans 10`, a multi-page answer for Q6 with an unlabeled continuation, and page navigation/highlight checks.

Suggested checks:

1. Q6 selects page 3 and shows both highlight regions after the continuation is mapped.
2. Q5(a) and Q5(b) remain separate questions.
3. Q8 is unanswered and scores zero.
4. `Ans 10` appears in Unmatched answers.
5. Zooming keeps the green boxes aligned.
