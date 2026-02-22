import { useRef } from 'react';
import emailjs from '@emailjs/browser';

export default function Contact() {
  const form = useRef();

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
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="max-w-2xl mx-auto bg-white p-6 md:p-8 rounded-lg shadow-md">
        <h2 className="text-2xl md:text-3xl font-bold mb-6 text-center text-gray-800">お問い合わせ</h2>
        <p className="mb-8 text-sm md:text-base text-gray-600 text-center">
          ご質問やご意見がありましたら、以下のフォームよりお送りください。<br/>
          <span className="text-xs text-blue-600">※自動で受付メールが届きます</span>
        </p>
        
        <form ref={form} onSubmit={sendEmail} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">お名前</label>
            <input 
              type="text" 
              name="name" 
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 outline-none" 
              placeholder="法政 太郎" 
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
            <input 
              type="email" 
              name="email" 
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 outline-none" 
              placeholder="example@hosei.jp" 
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">お問い合わせ内容</label>
            <textarea 
              name="message" 
              rows="4" 
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 outline-none" 
              placeholder="ここに内容を入力してください"
            ></textarea>
          </div>
          
          <button 
            type="submit" 
            className="w-full bg-blue-800 text-white py-3 px-4 rounded-md hover:bg-blue-700 transition font-bold shadow-md"
          >
            送信する
          </button>
        </form>
      </div>
    </div>
  );
}