"use client";
import QuestionList from "./QuestionList";
import AnswerViewer from "./AnswerViewer";

export default function MappingView() {
  return (
    <div className="flex h-full flex-col gap-4 p-4 lg:flex-row lg:gap-5 lg:p-5">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <QuestionList />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AnswerViewer />
      </div>
    </div>
  );
}
