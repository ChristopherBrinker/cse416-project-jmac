export const valid_benchmark = {
  schema_version: "1.0.0",
  name: "MyBenchmark",
  description: "",
  version: "1.0",
  items: [
    {
      item_id: "item1",
      prompt: "p",
      choices: ["choice1", "choice2", "choice3"],
      correct_choice: 1,
    },
    {
      item_id: "item2",
      prompt: "p2",
      choices: ["true", "false"],
      correct_choice: 0,
    },
  ],
} as any;
