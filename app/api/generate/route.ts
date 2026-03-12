import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import PDFDocument from 'pdfkit'

export const maxDuration = 60 // Vercel max for hobby plan

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface ResumeData {
  name: string
  contact: {
    email?: string
    phone?: string
    location?: string
    linkedin?: string
  }
  summary: string
  experience: Array<{
    title: string
    company: string
    dates: string
    bullets: string[]
  }>
  skills: string[]
  education: Array<{
    degree: string
    institution: string
    dates?: string
    details?: string
  }>
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return result.value.trim()
}

async function tailorResume(resumeText: string, jobDescription: string): Promise<ResumeData> {
  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    thinking: { type: 'adaptive' } as any,
    system: `You are an expert resume writer and career coach. Given a candidate's existing resume and a job description,
create a tailored resume that highlights the most relevant experience, skills, and achievements for that specific role.

Return ONLY a valid JSON object (no markdown, no code fences) with this exact structure:
{
  "name": "Full Name",
  "contact": {
    "email": "email@example.com",
    "phone": "+1 (555) 000-0000",
    "location": "City, State",
    "linkedin": "linkedin.com/in/handle"
  },
  "summary": "2-3 sentence professional summary tailored to the job, using keywords from the description",
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name",
      "dates": "Month Year – Month Year",
      "bullets": [
        "Quantified achievement relevant to the target role",
        "Another strong bullet with impact metrics"
      ]
    }
  ],
  "skills": ["Skill 1", "Skill 2", "Skill 3"],
  "education": [
    {
      "degree": "B.S. Computer Science",
      "institution": "University Name",
      "dates": "2020",
      "details": "GPA 3.8, Dean's List"
    }
  ]
}

Guidelines:
- Reorder experience bullets to prioritize relevance to the job
- Naturally incorporate keywords from the job description
- Quantify achievements wherever possible (%, $, time saved, etc.)
- Keep bullets concise and action-verb led
- Include only skills that are genuinely relevant
- Omit the "details" field for education if there's nothing notable to add
- Omit the "linkedin" field if not present in the original resume`,
    messages: [
      {
        role: 'user',
        content: `Job Description:\n${jobDescription}\n\n---\n\nMy Current Resume:\n${resumeText}`,
      },
    ],
  })

  for (const block of response.content) {
    if (block.type === 'text') {
      const text = block.text.trim()
      // Strip any accidental markdown fences
      const json = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '')
      return JSON.parse(json) as ResumeData
    }
  }

  throw new Error('No text response received from Claude')
}

function generatePDF(data: ResumeData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' })
    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const INDIGO = '#4F46E5'
    const DARK = '#111827'
    const MID = '#374151'
    const LIGHT = '#6B7280'
    const LINE = '#E5E7EB'
    const PAGE_WIDTH = doc.page.width - 100 // margins

    // ── Name ──────────────────────────────────────────────────────────────
    doc
      .font('Helvetica-Bold')
      .fontSize(22)
      .fillColor(DARK)
      .text(data.name, { align: 'center' })

    // ── Contact info ──────────────────────────────────────────────────────
    const { email, phone, location, linkedin } = data.contact
    const contactParts = [email, phone, location, linkedin].filter(Boolean)
    if (contactParts.length) {
      doc
        .moveDown(0.3)
        .font('Helvetica')
        .fontSize(9)
        .fillColor(LIGHT)
        .text(contactParts.join('  ·  '), { align: 'center' })
    }

    doc.moveDown(0.6)
    doc.moveTo(50, doc.y).lineTo(50 + PAGE_WIDTH, doc.y).strokeColor(LINE).lineWidth(1).stroke()
    doc.moveDown(0.5)

    const sectionHeader = (title: string) => {
      doc.moveDown(0.4)
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(INDIGO)
        .text(title.toUpperCase(), { characterSpacing: 1.5 })
      doc.moveDown(0.2)
      doc.moveTo(50, doc.y).lineTo(50 + PAGE_WIDTH, doc.y).strokeColor(INDIGO).lineWidth(0.5).stroke()
      doc.moveDown(0.4)
    }

    // ── Summary ───────────────────────────────────────────────────────────
    if (data.summary) {
      sectionHeader('Professional Summary')
      doc.font('Helvetica').fontSize(9.5).fillColor(MID).text(data.summary, { lineGap: 3 })
    }

    // ── Experience ────────────────────────────────────────────────────────
    if (data.experience?.length) {
      sectionHeader('Experience')
      data.experience.forEach((exp, i) => {
        if (i > 0) doc.moveDown(0.5)

        // Title + dates on same line
        const titleWidth = PAGE_WIDTH * 0.65
        const datesWidth = PAGE_WIDTH - titleWidth
        const yPos = doc.y

        doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(exp.title, 50, yPos, { width: titleWidth, continued: false })
        doc.font('Helvetica').fontSize(9).fillColor(LIGHT).text(exp.dates, 50 + titleWidth, yPos, { width: datesWidth, align: 'right' })

        doc.moveDown(0.1)
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(MID).text(exp.company)

        doc.moveDown(0.3)
        exp.bullets?.forEach((bullet) => {
          doc
            .font('Helvetica')
            .fontSize(9.5)
            .fillColor(MID)
            .text(`• ${bullet}`, { indent: 10, lineGap: 2.5 })
        })
      })
    }

    // ── Skills ────────────────────────────────────────────────────────────
    if (data.skills?.length) {
      sectionHeader('Skills')
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(MID)
        .text(data.skills.join('  ·  '), { lineGap: 3 })
    }

    // ── Education ─────────────────────────────────────────────────────────
    if (data.education?.length) {
      sectionHeader('Education')
      data.education.forEach((edu, i) => {
        if (i > 0) doc.moveDown(0.4)
        doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(edu.degree)
        const line = [edu.institution, edu.dates].filter(Boolean).join('  ·  ')
        doc.font('Helvetica').fontSize(9).fillColor(LIGHT).text(line)
        if (edu.details) {
          doc.font('Helvetica-Oblique').fontSize(9).fillColor(MID).text(edu.details)
        }
      })
    }

    doc.end()
  })
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('resume') as File | null
    const jobDescription = (formData.get('job_description') as string | null)?.trim()

    if (!file) return NextResponse.json({ error: 'No resume file uploaded.' }, { status: 400 })
    if (!jobDescription) return NextResponse.json({ error: 'Job description is required.' }, { status: 400 })
    if (!file.name.endsWith('.docx')) return NextResponse.json({ error: 'Only .docx files are supported.' }, { status: 400 })

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const resumeText = await extractDocxText(buffer)
    if (!resumeText) return NextResponse.json({ error: 'Could not extract text from the uploaded file.' }, { status: 400 })

    const resumeData = await tailorResume(resumeText, jobDescription)
    const pdf = await generatePDF(resumeData)

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="tailored_resume.pdf"',
      },
    })
  } catch (err: unknown) {
    console.error('Generate error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
