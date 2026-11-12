# PROMPT: Build Mini Task Manager — Clean, Minimal, No AI Slop

Act as a Senior Full-Stack Developer, Software Architect, and Product Designer.

Your task is to design and implement a lightweight shared task management web application for exactly two people.

The application must be simple, practical, fast, and maintainable.

Do not overengineer the system. Do not add features that were not requested.

## 1. Technology Stack

- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Google Apps Script (V8)
- Database: Google Sheets
- Image Storage: Google Drive
- Deployment: Google Apps Script Web App
- Frontend communication: `google.script.run`

Do not introduce React, Next.js, Node.js, or unnecessary frameworks.

## 2. Core Requirements

The application must support:

- Create tasks.
- Edit tasks.
- Delete tasks.
- Change task status.
- List View.
- Kanban Board.
- Search tasks.
- Attach multiple images to a task.
- Paste images directly using Ctrl + V.
- Drag and drop image files.
- Select images through a file picker.
- Preview images before uploading.
- View attached images in a gallery.
- Two people share and manage the same task data.

## 3. Task Data Model

Keep the task model intentionally minimal.

Required fields:

- `task_id`
- `title`
- `description`
- `status`
- `priority`
- `created_at`
- `updated_at`
- `position`

Status:
- `todo`
- `in_progress`
- `done`

Priority:
- `low`
- `medium`
- `high`

### Strictly Forbidden Fields

Do NOT implement:

- Start Date
- Due Date
- Assignee
- Tags
- Created By
- Estimated Hours
- Time Tracking
- User Accounts
- Task Ownership
- Unrequested Metadata

Do not add these fields to the UI, database, forms, or API.

## 4. Views

### List View

Display:
- Task title
- Status
- Optional priority
- Image attachment indicator

Provide simple actions to edit, delete, and change status.

### Kanban Board

Three columns:

1. To Do
2. In Progress
3. Done

Features:
- Drag and drop tasks between columns.
- Update task status automatically.
- Allow moving tasks back to previous statuses.
- Provide a mobile-friendly status selector.

Both views must use the same underlying task data.

## 5. Image Attachments

This is an important feature.

Support three upload methods:

1. Clipboard Paste: Press Ctrl + V to paste copied images directly.
2. Drag & Drop: Drag image files into the attachment area.
3. File Picker: Select one or multiple image files.

Requirements:
- Multiple images per task.
- Preview before uploading.
- Remove images before saving.
- Store image files in Google Drive.
- Store image metadata and Drive file IDs in Google Sheets.
- Display attached images in a gallery.
- Click an image to view a larger preview.

Suggested initial limits:
- Maximum 10 images per task.
- Maximum 8 MB per image.
- JPG, PNG, and WebP.

Validate file types and sizes on both frontend and backend.

## 6. UI/UX Design

Design a clean, minimal, professional interface.

Visual direction:
- Inspired by Linear's simplicity and clarity.
- Neutral color palette.
- White or subtle off-white background.
- Restrained accent color.
- Clear typography.
- Consistent spacing.
- Subtle borders.
- Minimal shadows.
- Practical information density.

### Anti-AI-Slop Rules

The interface must not look like a generic AI-generated SaaS template.

Strictly avoid:
- Excessive gradients.
- Glassmorphism.
- Glowing effects.
- Oversized headings.
- Decorative floating shapes.
- Unnecessary cards inside cards.
- Excessive rounded corners.
- Too many badges.
- Random icons and illustrations.
- Fake statistics and charts.
- Unnecessary dashboard sections.
- Excessive whitespace.

Every component must serve a real functional purpose.

Prioritize usability, consistency, and clarity over visual effects.

## 7. Main Application Layout

The application must open directly to the task list.

Do NOT create:
- Login page.
- Registration page.
- Dashboard.
- Analytics.
- Reports.
- Charts.
- Summary cards.

Main interface:
- Application title: Mini Tasks.
- Search field.
- List / Board view switcher.
- Add Task button.
- Task content.

## 8. Task Form

Create a simple Add/Edit Task modal.

Fields:
- Title (required).
- Description (optional).
- Status.
- Priority (optional).
- Image attachments (optional).

Only include these fields.

## 9. Architecture

Keep the project modular and organized.

Suggested structure:

```text
MiniTaskManager/
├── appsscript.json
├── server/
│   ├── Code.gs
│   ├── Config.gs
│   ├── Database.gs
│   ├── TaskService.gs
│   ├── ImageService.gs
│   ├── Validation.gs
│   └── Utils.gs
├── client/
│   ├── Index.html
│   ├── Main.html
│   ├── styles/
│   ├── scripts/
│   └── components/
└── README.md
```

Use clear separation between:
- UI rendering.
- Application state.
- API communication.
- Task operations.
- Image operations.
- Database operations.

## 10. Security and Reliability

The application uses public access without login.

Anyone with the URL can view and modify tasks. Make this limitation explicit in the README.

Additional requirements:
- Validate all server-side inputs.
- Use `LockService` for concurrent writes.
- Batch Google Sheets operations.
- Avoid unnecessary Drive and Sheets API calls.
- Handle upload errors.
- Handle deleted or missing images.
- Prevent duplicate submissions.
- Provide meaningful error messages.
- Avoid exposing unnecessary internal information.
- Do not treat rate limiting as authentication.

## 11. Development Workflow

Before implementing:

1. Analyze the requirements.
2. Propose the system architecture.
3. Define the database schema.
4. Define API functions.
5. Plan the UI components.
6. Identify technical limitations of Google Apps Script.
7. Create a practical implementation roadmap.

Then implement in small, logical phases.

After each phase:
- Test the functionality.
- Review the code.
- Fix errors.
- Update documentation.

Do not implement everything in one giant file.

## 12. Final Acceptance Criteria

The application is complete when:

- It opens directly to the task list.
- No login is required.
- Two people can share the same tasks.
- Tasks can be created, edited, and deleted.
- Tasks can move between all three statuses.
- List and Kanban views work correctly.
- Search works.
- Multiple images can be attached.
- Ctrl + V image paste works.
- Drag and drop works.
- Image previews and gallery work.
- The UI works on desktop and mobile.
- No forbidden fields are present.
- No unnecessary dashboard or analytics features exist.

## google

- https://docs.google.com/spreadsheets/d/1rjxhkKGdB4YUC5Iaxct75t5fsK-sYmIZg3TKEkrCMJs/edit?usp=sharing

- https://drive.google.com/drive/folders/1pe7XKonT1PI7BBzqnkISF8K8P5E78oBR?usp=sharing

**Final Principle: Build a small, focused tool that does a few things exceptionally well. Do not turn it into a complex project management platform.**