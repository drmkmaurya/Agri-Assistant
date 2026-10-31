// Razorpay Compliance & Transparent Legal Policies
const policyDocs = {
    terms: `
        <h4 style="color:#075e54; margin-bottom:8px; font-weight:700;">नियम एवं शर्तें (Terms & Conditions)</h4>
        <p style="margin-bottom:8px;">1. <b>सेवा का स्वरूप (Advisory Only):</b> Agri Assistant एक AI-संचालित डिजिटल कृषि परामर्श प्लेटफॉर्म है, जो प्राकृतिक कृषि, पंच महाभूत और जैविक पद्धतियों की उपलब्ध वीडियो लाइब्रेरी के आधार पर मार्गदर्शन प्रदान करता है।</p>
        <p style="margin-bottom:8px;">2. <b>मार्गदर्शन मात्र (No Guarantee):</b> यह सलाह सामान्य समझ और कृषि सिद्धांतों पर आधारित है। हम किसी भी फसल की निश्चित पैदावार या आय वृद्धि की कानूनी गारंटी नहीं देते। अंतिम निर्णय किसान का होगा।</p>
        <p style="margin-bottom:8px;">3. <b>क्रेडिट खपत स्लैब (Credit Slabs):</b> 
        • केवल टेक्स्ट प्रश्न: 1 क्रेडिट<br>
        • प्रश्न + 1 फोटो जांच: 2 क्रेडिट<br>
        • प्रश्न + 2 फोटो जांच: 3 क्रेडिट (अधिकतम सीमा: 2 फाइलें प्रति प्रश्न)
        </p>
        <p style="margin-bottom:8px;">4. <b>निःशुल्क प्लान नियम:</b> निःशुल्क उपयोगकर्ताओं को प्रतिदिन 3 सवाल मिलते हैं जो प्रतिदिन मध्यरात्रि 12:00 AM IST पर रीसेट होते हैं (कोई रोलओवर नहीं)। फोटो अटैचमेंट केवल सशुल्क प्लान्स में उपलब्ध है।</p>
        <p style="margin-bottom:8px;">5. <b>सशुल्क प्लान वैधता:</b> सशुल्क प्लान ठीक 30 दिन बाद उसी सटीक मिनट और सेकंड पर समाप्त होते हैं जिस समय भुगतान हुआ था।</p>
    `,
    privacy: `
        <h4 style="color:#075e54; margin-bottom:8px; font-weight:700;">गोपनीयता नीति (Privacy Policy)</h4>
        <p style="margin-bottom:8px;">हम आपकी गोपनीयता का सम्मान करते हैं। Google Sign-in के माध्यम से केवल आपका मूल नाम, ईमेल आईडी और प्रोफाइल फोटो खाता पहचान एवं क्रेडिट संतुलन प्रबंधन हेतु सुरक्षित रखे जाते हैं।</p>
        <p style="margin-bottom:8px;"><b>24-Hour Rolling Local Storage:</b> आपके द्वारा भेजे गए संदेश और फाइलें हमारे सर्वर पर स्थायी रूप से स्टोर नहीं होते हैं। वे आपके डिवाइस के ब्राउज़र में अधिकतम 24 घंटे के लिए ही सुरक्षित रहते हैं और 24 घंटे बाद स्वतः निष्कासित हो जाते हैं।</p>
        <p>सभी ऑनलाइन भुगतान आरबीआई (RBI) द्वारा प्रमाणित Razorpay पेमेंट गेटवे के माध्यम से सुरक्षित संसाधित होते हैं।</p>
    `,
    pricing: `
        <h4 style="color:#075e54; margin-bottom:8px; font-weight:700;">मूल्य निर्धारण नीति (Pricing Policy)</h4>
        <p style="margin-bottom:8px;">Agri Assistant के पारदर्शी क्रेडिट पैक्स:</p>
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:10px; border-radius:8px; margin-bottom:8px;">
            <b>1. Basic Plan:</b> ₹49 में 100 क्रेडिट्स (वैधता: 30 दिन)<br>
            <span style="font-size:11.5px; color:#15803d;">टेक्स्ट एवं फोटो जांच दोनों अनुमत।</span>
        </div>
        <div style="background:#fefce8; border:1px solid #fef08a; padding:10px; border-radius:8px; margin-bottom:8px;">
            <b>2. Pro Plan:</b> ₹99 में 300 क्रेडिट्स (वैधता: 30 दिन)<br>
            <span style="font-size:11.5px; color:#854d0e;">गहन कृषि एवं नियमित फोटो डायग्नोसिस हेतु प्राथमिकता सेवा।</span>
        </div>
        <p style="font-size:11.5px; color:#64748b;">*सभी शुल्क भारतीय रुपये (INR) में हैं और लागू करों सहित अंतिम हैं।</p>
    `,
    refund: `
        <h4 style="color:#075e54; margin-bottom:8px; font-weight:700;">वापसी एवं रद्दीकरण नीति (Refund Policy)</h4>
        <p style="margin-bottom:8px;">1. <b>नॉन-रिफंडेबल (Non-Refundable):</b> डिजिटल क्रेडिट्स सक्रिय होते ही तुरंत उपयोग योग्य हो जाते हैं, अतः सक्रिय होने के पश्चात किसी भी परिस्थिति में रिफंड स्वीकार्य नहीं होगा।</p>
        <p style="margin-bottom:8px;">2. <b>तकनीकी विफलता अपवाद:</b> यदि आपके खाते से पैसे कट गए हैं किंतु <b>2 घंटे के भीतर</b> क्रेडिट्स नहीं जुड़े, तो आप सहायता फॉर्म या ईमेल द्वारा सूचित करें।</p>
        <p style="margin-bottom:8px;">3. <b>रिफंड समयसीमा:</b> विफलता सत्यापित होने पर 100% राशि <b>5 से 7 कार्यदिवसों (Working Days)</b> में आपके मूल बैंक खाते में वापस प्रेषित कर दी जाएगी।</p>
    `,
    contact: `
        <h4 style="color:#075e54; margin-bottom:8px; font-weight:700;">संपर्क एवं आधिकारिक सहायता (Support)</h4>
        <p style="margin-bottom:8px;">किसी भी सहायता या बिलिंग पूछताछ के लिए हमसे संपर्क करें:</p>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:8px; line-height:1.7;">
            📧 <b>ईमेल:</b> <a href="mailto:mauryarohit21052017@gmail.com" style="color:#008069; font-weight:600; text-decoration:none;">mauryarohit21052017@gmail.com</a><br>
            📍 <b>स्थान:</b> उत्तर प्रदेश, भारत<br>
            ⏰ <b>कार्य समय:</b> सोमवार से शनिवार (सुबह 10:00 से शाम 06:00 बजे तक)
        </div>
    `
};
