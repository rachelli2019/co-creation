export interface SurveyQuestion {
  id: string; text: string; description?: string; kind?: 'text' | 'credit' | 'choice' | 'checklist'; choices?: string[]; choiceLayout?: 'vertical'; labels?: string[]; min?: number; max?: number; aiOnly?: boolean;
}
export interface SurveyPage {id: string; title: string; intro?: string; questions: SurveyQuestion[]}
const familiar = ['Not at all familiar', 'Slightly familiar', 'Somewhat familiar', 'Very familiar', 'Extremely familiar'];
const ability = ['Very poor', 'Poor', 'Average', 'Good', 'Excellent'];
const agreement = ['Strongly disagree', 'Disagree', 'Neither agree nor disagree', 'Agree', 'Strongly agree'];
const agree = (id: string, text: string, aiOnly = false): SurveyQuestion => ({id, text, labels: agreement, min: 1, max: 5, aiOnly});
export const surveyPages: SurveyPage[] = [
  {id: 'experience', title: 'Your experience and approach', questions: [
    {id: 'ai_familiarity', text: 'How familiar are you with using AI for general tasks?', labels: familiar, min: 1, max: 5},
    {id: 'ai_writing_familiarity', text: 'How familiar are you with using AI writing assistants for writing (creative or otherwise)?', labels: familiar, min: 1, max: 5},
    {id: 'ai_strategy', text: 'What was your strategy in using the AI writing assistant to complete your writing task?', kind: 'text', aiOnly: true},
    {id: 'credit', text: 'How much credit do you think you deserve for the final short story?', kind: 'credit'},
  ]},
  {id: 'ai_literacy', title: 'Your ability to work with AI', intro: 'How would you rate your general ability to do the following when using AI?', questions: [
    {id: 'ai_literacy_1', text: 'Use AI to improve your productivity.'},
    {id: 'ai_literacy_2', text: 'Direct the AI so that you obtain the output that you seek.'},
    {id: 'ai_literacy_3', text: 'Build upon and complement the AI’s output.'},
    {id: 'ai_literacy_4', text: 'Determine what information the AI needs to perform the task appropriately.'},
    {id: 'ai_literacy_6', text: 'Use AI to improve the quality of your decisions or work.'},
  ].map(q => ({...q, labels: ability, min: 1, max: 5}))},
  {id: 'metacognition', title: 'When using an AI writing assistant', intro: 'When using an AI writing assistant, how much do you agree with each statement?', questions: [
    // Planning
    {id: 'caim_p1', text: 'I think about how to give the most appropriate information to the AI.'},
    {id: 'caim_p2', text: 'I consider what information the AI needs to perform the task.'},
    {id: 'caim_p3', text: 'I think about how well I understand what the AI is good and not so good at for the task we’re doing.'},
    {id: 'caim_p4', text: 'I think about the best way to divide the work between me and the AI.'},
    // Monitoring
    {id: 'caim_m1', text: 'I review my thinking to ensure that I’m not accepting or rejecting the AI’s recommendation too quickly.'},
    {id: 'caim_m2', text: 'When working with the AI, I check task goals every now and then to make sure we’re on track.'},
  ].map(q => ({...q, min: 1, max: 5, labels: agreement}))},
  {id: 'trust', title: 'Outcomes and AI writing assistant', intro: 'How much do you agree with each statement?', questions: [
    agree('outcome_match', 'The outcome matched what I had aimed for in this task.'),
    agree('ai_writing_capability_1', 'The AI writing assistant is very capable of writing short stories.', true),
    agree('ai_writing_capability_2', 'The AI writing assistant has much knowledge about short story writing.', true),
    agree('ai_writing_capability_3', 'I feel very confident about the AI writing assistant’s skills.', true),
    agree('ai_writing_capability_4', 'The AI writing assistant has specialized capabilities that can improve my short story writing.', true),
    // Reverse-code willingness item 1 during analysis; store raw responses.
    agree('ai_writing_willingness_1', "If I had my way, I wouldn't let the AI writing assistant have any influence over creative decisions that are important to me.", true),
    agree('ai_writing_willingness_2', 'I would be willing to let the AI writing assistant have complete control over my short story.', true),
  ]},
  {id: 'attitudes', title: 'AI attitudes', intro: 'Choose one answer for each question.', questions: [
    {id: 'concernExcitement', kind: 'choice', text: 'Overall, would you say the increased use of artificial intelligence (AI) in daily life makes you feel…', choices: ['More concerned than excited', 'Equally concerned and excited', 'More excited than concerned']},
    {id: 'creativityImpact', kind: 'choice', text: 'Do you think artificial intelligence (AI) will make people’s ability to think creatively better, worse, or not much different?', choices: ['Worse', 'Not much different', 'Better']},
  ]},
  {id: 'creative_writing', title: 'Creative Writing', intro: 'Please answer the following questions about your creative writing experience.', questions: [
    agree('creative_writing_comfort', 'I feel comfortable completing creative writing tasks.'),
    {id: 'creative_writing_experience_frequency', kind: 'choice', choiceLayout: 'vertical', text: 'How much experience do you have with creative writing outside of required elementary, middle, or high school assignments?',
      description: 'Creative writing includes fiction, short stories, poetry, scripts, and other original creative works. You may include writing for personal enjoyment, university courses, or publication.',
      choices: [
        'No experience',
        'Have tried creative writing once or twice',
        'Have done creative writing a handful of times',
        'Have written creatively on occasion over months or years',
        'Have written creatively regularly over an extended period',
      ]},
    {id: 'creative_writing_courses', kind: 'choice', choiceLayout: 'vertical', text: 'Have you ever taken a creative writing course or workshop?', choices: ['No', 'Yes, one', 'Yes, two or more']},
  ]},
];
