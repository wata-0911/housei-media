import { useRef, useEffect } from 'react';
import emailjs from '@emailjs/browser';
import { motion } from 'framer-motion';

export default function Contact() {
  const form = useRef();

  // Noto Serif JPフォントを適用
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400;500;600&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  const sendEmail = (e) => {
    e.preventDefault();

    const serviceID = "service_b5sraka";  
    const templateID = "template_jhmfyap"; 
    const publicKey = "umXFZiSN06rMS20D0";   

    emailjs.sendForm(serviceID, templateID, form.current, publicKey)
      .then((result) => {
          alert('送信しました！自動返信メールをご確認ください。');
          form.current.reset();
      }, (error) => {
          console.log(error.text);
          alert('送信に失敗しました。もう一度お試しください。');
      });
  };

  return (
    <div className="bg-[#FAFAFA] text-[#1A1A1A] min-h-screen antialiased" style={{ fontFamily: '"Noto Serif JP", serif' }}>
      
      {/* ヒーローセクション */}
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

      {/* フォームセクション */}
      <section className="py-20 md:py-32">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="bg-white p-8 md:p-16 relative z-20 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.08)] border-t-4 border-[#002255]"
          >
            
            <p className="mb-12 text-sm md:text-base text-[#666666] text-center font-light leading-relaxed tracking-wide">
              ご質問やご意見がありましたら、以下のフォームよりお送りください。<br/>
              <span className="text-xs text-[#E65C00] mt-3 inline-block font-medium">※自動で受付メールが届きます</span>
            </p>
            
            <form ref={form} onSubmit={sendEmail} className="space-y-8">
              
              {/* お名前 */}
              <div>
                <label className="block text-sm font-medium text-[#002255] mb-2 tracking-widest">
                  お名前
                </label>
                <input 
                  type="text" 
                  name="name" 
                  required
                  className="w-full px-4 py-4 bg-[#FAFAFA] border border-gray-200 focus:bg-white focus:ring-2 focus:ring-[#002255] focus:border-[#002255] outline-none transition-all duration-300 font-light tracking-wide text-[#1A1A1A] placeholder-gray-400 rounded-sm" 
                  placeholder="法政 太郎" 
                />
              </div>
              
              {/* メールアドレス */}
              <div>
                <label className="block text-sm font-medium text-[#002255] mb-2 tracking-widest">
                  メールアドレス
                </label>
                <input 
                  type="email" 
                  name="email" 
                  required
                  className="w-full px-4 py-4 bg-[#FAFAFA] border border-gray-200 focus:bg-white focus:ring-2 focus:ring-[#002255] focus:border-[#002255] outline-none transition-all duration-300 font-light tracking-wide text-[#1A1A1A] placeholder-gray-400 rounded-sm" 
                  placeholder="example@hosei.jp" 
                />
              </div>
              
              {/* お問い合わせ内容 */}
              <div>
                <label className="block text-sm font-medium text-[#002255] mb-2 tracking-widest">
                  お問い合わせ内容
                </label>
                <textarea 
                  name="message" 
                  rows="6" 
                  required
                  className="w-full px-4 py-4 bg-[#FAFAFA] border border-gray-200 focus:bg-white focus:ring-2 focus:ring-[#002255] focus:border-[#002255] outline-none transition-all duration-300 font-light tracking-wide text-[#1A1A1A] placeholder-gray-400 resize-none rounded-sm" 
                  placeholder="ここに内容を入力してください"
                ></textarea>
              </div>
              
              {/* 送信ボタン */}
              <div className="pt-6 text-center">
                <motion.button 
                  whileTap={{ scale: 0.95 }}
                  type="submit" 
                  className="inline-flex justify-center items-center text-white bg-[#E65C00] hover:bg-[#CC5200] text-sm tracking-widest px-12 py-4 rounded-md shadow-md hover:shadow-lg transition-all duration-300 font-medium"
                >
                  送信する
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