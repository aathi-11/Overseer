import httpx
import asyncio

RAG_URL = "http://localhost:8000"

SEED_DOCS = [
    # ── Specific app patterns ──────────────────────────────────────────────
    {
        "id": "seed-html-calculator",
        "content": "To build a working HTML basic calculator: use a div with id='display' showing '0', store operand1, operand2, operator as JS variables. Each number button appends to display. Operator buttons store current display as operand1 and the operator. Equals button computes result using if/else for +,-,*,/. Clear resets all variables and display to 0. All buttons use onclick attribute.",
        "metadata": {"type": "pattern", "topic": "calculator"}
    },
    {
        "id": "seed-html-compound-interest",
        "content": "To build a working HTML compound interest calculator: use input fields for Principal (id='principal'), Annual Rate % (id='rate'), Time in years (id='time'), and Compounds per year (id='n', default 12). A Calculate button calls calculate(). The formula is: A = P * (1 + r/n)^(n*t) where r=rate/100. Show: Final Amount, Total Interest Earned (A - P), and a breakdown table by year. Use parseFloat() for inputs. Style with a clean card layout. Never build a basic arithmetic calculator for this request.",
        "metadata": {"type": "pattern", "topic": "compound-interest"}
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
        "id": "seed-html-weather",
        "content": "To build a working HTML weather dashboard (mock data): store city weather data as a JS object with temperature, humidity, wind speed, and condition. Use a city select dropdown to switch displayed data. Render weather card with large temperature display, icons represented by emoji, and a 5-day forecast row with min/max temps.",
        "metadata": {"type": "pattern", "topic": "weather"}
    },
    {
        "id": "seed-html-portfolio",
        "content": "To build a working HTML portfolio page: include a nav with smooth-scroll links, hero section with name and title, skills section with visual progress bars (CSS width %), projects grid with card hover effects, and a contact form. Use CSS variables for theme colors. All sections have unique IDs for anchor navigation.",
        "metadata": {"type": "pattern", "topic": "portfolio"}
    },
    {
        "id": "seed-html-expense-tracker",
        "content": "To build a working HTML expense tracker: use input fields for description and amount, a category select, and an Add button. Store expenses in an array. render() builds a table of entries with delete buttons. Show total at the bottom. Persist to localStorage. Optionally show a pie chart using canvas drawArc for each category percentage.",
        "metadata": {"type": "pattern", "topic": "expense-tracker"}
    },
    # ── Structure rules ────────────────────────────────────────────────────
    {
        "id": "seed-html-structure",
        "content": "All generated HTML apps must follow this structure: <!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'><title>App</title><style> /* all CSS here */ </style></head><body> /* all HTML here */ <script> /* all JavaScript here, at bottom of body */ </script></body></html>. Never use external libraries or CDNs. Always close every tag. Always end with </html>.",
        "metadata": {"type": "rule", "topic": "structure"}
    },
    # ── Requirement patterns ───────────────────────────────────────────────
    {
        "id": "seed-req-user-stories",
        "content": "When writing user stories for a web app: follow the format 'As a [user], I want to [action] so that [benefit]'. Include at minimum: one story for core functionality, one for data persistence, one for error handling, and one for UI feedback. Group stories by epic (Core, Data, UX, Edge Cases).",
        "metadata": {"type": "requirement", "topic": "user-stories"}
    },
    {
        "id": "seed-req-acceptance-criteria",
        "content": "Acceptance criteria should use Given/When/Then format. Example for a calculator: Given the app is loaded, When I press 5+3=, Then the display shows 8. Always include criteria for: happy path, empty/null inputs, boundary values, and reset/clear behavior.",
        "metadata": {"type": "requirement", "topic": "acceptance-criteria"}
    },
    # ── Test patterns ──────────────────────────────────────────────────────
    {
        "id": "seed-test-general",
        "content": "For HTML app testing: always test edge cases like empty input, max input length, invalid data types (letters in number fields), rapid button clicks, and browser refresh state persistence. For forms: test required field validation, numeric-only fields rejecting letters, and submit with all fields empty.",
        "metadata": {"type": "test", "topic": "general"}
    },
    {
        "id": "seed-test-calculator",
        "content": "Test cases for a calculator app: 1) Basic ops: 2+3=5, 10-4=6, 3*4=12, 10/2=5. 2) Division by zero should show 'Error' not crash. 3) Chained operations: 2+3*4 should follow correct order. 4) Decimal results: 1/3 shows truncated decimal. 5) Clear button resets all state. 6) Multi-digit input: 123+456=579. 7) Negative result: 3-9=-6.",
        "metadata": {"type": "test", "topic": "calculator"}
    },
    {
        "id": "seed-test-compound-interest",
        "content": "Test cases for compound interest calculator: 1) P=1000, r=5%, t=1yr, n=12 → A≈1051.16. 2) P=5000, r=10%, t=5yrs, n=1 → A≈8052.55. 3) Zero rate → A=P (no growth). 4) Zero principal → A=0. 5) Negative rate should show error or 0. 6) Non-numeric input should show validation error. 7) n=365 (daily compounding) should give higher result than n=1.",
        "metadata": {"type": "test", "topic": "compound-interest"}
    },
    {
        "id": "seed-test-todo",
        "content": "Test cases for todo app: 1) Add task with valid text → appears in list. 2) Add empty task → should not add, show validation. 3) Delete first/middle/last task. 4) Add 10+ tasks and verify all render. 5) Refresh page → tasks persist from localStorage. 6) Very long task text wraps correctly without breaking layout.",
        "metadata": {"type": "test", "topic": "todo"}
    },
]

async def seed():
    async with httpx.AsyncClient(timeout=30) as client:
        for doc in SEED_DOCS:
            try:
                res = await client.post(f"{RAG_URL}/store", json=doc)
                result = res.json()
                status = "[OK]" if result.get("stored") else "[ERR]"
                print(f"{status} {doc['id']} [{doc['metadata']['type']}]: {result}")
            except Exception as e:
                print(f"[ERR] {doc['id']}: ERROR -- {e}")
    print(f"\nSeeding complete. {len(SEED_DOCS)} documents processed.")

if __name__ == "__main__":
    asyncio.run(seed())
