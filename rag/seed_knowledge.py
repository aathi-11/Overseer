import httpx
import asyncio

RAG_URL = "http://localhost:8000"

SEED_DOCS = [
    {
        "id": "seed-html-calculator",
        "content": "To build a working HTML calculator: use a div with id='display' showing '0', store operand1, operand2, operator as JS variables. Each number button appends to display. Operator buttons store current display as operand1 and the operator. Equals button computes result using if/else for +,-,*,/. Clear resets all variables and display to 0. All buttons use onclick attribute.",
        "metadata": {"type": "pattern", "topic": "calculator"}
    },
    {
        "id": "seed-html-todo",
        "content": "To build a working HTML todo/task app: use an input field and Add button. Store tasks in a JS array. On Add, push to array and call render(). render() clears the ul and loops array to create li elements each with a delete button. Delete button calls splice on array index and re-renders. Use localStorage to persist between refreshes.",
        "metadata": {"type": "pattern", "topic": "todo"}
    },
    {
        "id": "seed-html-timer",
        "content": "To build a working HTML countdown timer: store totalSeconds as a number. Use setInterval stored in a variable. On Start, call setInterval every 1000ms decrementing totalSeconds and updating display formatted as Math.floor(s/60) + ':' + padStart(s%60, 2, '0'). On Pause call clearInterval. On Reset clear interval and restore original value.",
        "metadata": {"type": "pattern", "topic": "timer"}
    },
    {
        "id": "seed-html-quiz",
        "content": "To build a working HTML quiz app: store questions as a JS array of objects each with question string, options array, and answer string. Track currentIndex and score as variables. Render current question and 4 option buttons. On option click compare to answer, increment score if correct, move to next question. After last question show final score screen.",
        "metadata": {"type": "pattern", "topic": "quiz"}
    },
    {
        "id": "seed-html-notes",
        "content": "To build a working HTML notes app: use a textarea and Save button. Store notes in an array. On Save push textarea value to array and call render(). render() loops array creating div cards each with note text and a delete button. Delete splices array and re-renders. Show note count in header.",
        "metadata": {"type": "pattern", "topic": "notes"}
    },
    {
        "id": "seed-html-structure",
        "content": "All generated HTML apps must follow this structure: <!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'><title>App</title><style> /* all CSS here */ </style></head><body> /* all HTML here */ <script> /* all JavaScript here, at bottom of body */ </script></body></html>. Never use external libraries or CDNs. Always close every tag. Always end with </html>.",
        "metadata": {"type": "rule", "topic": "structure"}
    }
]

async def seed():
    async with httpx.AsyncClient(timeout=30) as client:
        for doc in SEED_DOCS:
            res = await client.post(f"{RAG_URL}/store", json=doc)
            print(f"Stored {doc['id']}: {res.json()}")
    print("Seeding complete.")

if __name__ == "__main__":
    asyncio.run(seed())
