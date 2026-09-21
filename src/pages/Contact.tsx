import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';

type ContactApiResponse = {
  status: 'success' | 'error'
  message?: string
}

function isContactApiResponse(value: unknown): value is ContactApiResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'status' in value &&
    (value.status === 'success' || value.status === 'error') &&
    (!('message' in value) || typeof value.message === 'string')
  )
}

export default function Contact() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sendEmail = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formElement = e.currentTarget
    const formData = new FormData(formElement)

    const data = {
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      message: String(formData.get('message') ?? ''),
    }

    const gasUrl = "https://script.google.com/macros/s/AKfycbwJdQvB7ZUcirtgj7c310lh5hBgkz0lcp8qO6OmlCIoG2U4FQetz7T_jbjXM8gKKbPf/exec";

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 10_000)

    try {
      const response = await fetch(gasUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      const result: unknown = await response.json()

      if (!isContactApiResponse(result)) {
        throw new Error('Invalid contact API response')
      }

      if (result.status === 'success') {
        alert('送信しました！自動返信メールをご確認ください。')
        formElement.reset()
      } else {
        throw new Error(result.message ?? 'Unknown error')
      }
    } catch (error) {
      console.error(error)
      if (controller.signal.aborted) {
        alert('送信結果を確認できませんでした。処理が完了している可能性があります。自動返信メールをご確認ください。')
      } else {
        alert('送信に失敗しました。時間をおいてからもう一度お試しください。')
      }
    } finally {
      window.clearTimeout(timeoutId)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="bg-[#FAFAFA] text-[#1A1A1A] min-h-screen antialiased" style={{ fontFamily: '"Noto Serif JP", serif' }}>

      <section className="bg-[#002255] text-white py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
        <div className="container mx-auto px-4 text-center relative z-10">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="block text-[#E65C00] text-sm tracking-[0.2em] font-medium mb-4"
          >
            CONTACT
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-3xl md:text-5xl font-light tracking-wider"
          >
            お問い合わせ
          </motion.h2>
        </div>
      </section>

      <section className="py-20 md:py-32">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="bg-white p-8 md:p-16 relative z-20 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.08)] border-t-4 border-[#002255]"
          >

            <p className="mb-12 text-sm md:text-base text-[#666666] text-center font-light leading-relaxed tracking-wide">
              ご質問やご意見がありましたら、以下のフォームよりお送りください。<br />
              <span className="text-xs text-[#E65C00] mt-3 inline-block font-medium">※自動で受付メールが届きます</span>
            </p>

            <form onSubmit={sendEmail} className="space-y-8">

              <div>
                <label htmlFor="contact-name" className="block text-sm font-medium text-[#002255] mb-2 tracking-widest">
                  お名前
                </label>
                <input
                  type="text"
                  name="name"
                  id="contact-name"
                  autoComplete="name"
                  required
                  className="w-full px-4 py-4 bg-[#FAFAFA] border border-gray-200 focus:bg-white focus:ring-2 focus:ring-[#002255] focus:border-[#002255] outline-none transition-all duration-300 font-light tracking-wide text-[#1A1A1A] placeholder-gray-400 rounded-sm"
                  placeholder="法政 太郎"
                />
              </div>

              <div>
                <label htmlFor="contact-email" className="block text-sm font-medium text-[#002255] mb-2 tracking-widest">
                  メールアドレス
                </label>
                <input
                  type="email"
                  name="email"
                  id="contact-email"
                  autoComplete="email"
                  required
                  className="w-full px-4 py-4 bg-[#FAFAFA] border border-gray-200 focus:bg-white focus:ring-2 focus:ring-[#002255] focus:border-[#002255] outline-none transition-all duration-300 font-light tracking-wide text-[#1A1A1A] placeholder-gray-400 rounded-sm"
                  placeholder="example@hosei.jp"
                />
              </div>

              <div>
                <label htmlFor="contact-message" className="block text-sm font-medium text-[#002255] mb-2 tracking-widest">
                  お問い合わせ内容
                </label>
                <textarea
                  name="message"
                  id="contact-message"
                  rows={6}
                  required
                  className="w-full px-4 py-4 bg-[#FAFAFA] border border-gray-200 focus:bg-white focus:ring-2 focus:ring-[#002255] focus:border-[#002255] outline-none transition-all duration-300 font-light tracking-wide text-[#1A1A1A] placeholder-gray-400 resize-none rounded-sm"
                  placeholder="ここに内容を入力してください"
                ></textarea>
              </div>

              <div className="pt-6 text-center">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex justify-center items-center text-white bg-[#E65C00] hover:bg-[#CC5200] text-sm tracking-widest px-12 py-4 rounded-md shadow-md hover:shadow-lg transition-all duration-300 font-medium disabled:opacity-50"
                >
                  {isSubmitting ? '送信中...' : '送信する'}
                  <svg className="w-5 h-5 ml-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                  </svg>
                </motion.button>
              </div>

            </form>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
