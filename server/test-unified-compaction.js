const axios = require('axios');

// Test configuration
const BASE_URL = 'http://localhost:50001';
const TEST_SESSION_ID = 'test-unified-compaction-' + Date.now();

// Helper function to make AI scheduling requests
async function makeAIScheduleRequest(description, sessionId = TEST_SESSION_ID) {
  try {
    const response = await axios.post(`${BASE_URL}/api/ai/schedule`, {
      description,
      preferences: '',
      existingEvents: [],
      timezone: 'UTC'
    }, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId
      }
    });
    return response.data;
  } catch (error) {
    console.error('AI schedule request failed:', error.response?.data || error.message);
    return null;
  }
}

// Test function
async function testUnifiedCompaction() {
  console.log('🧪 Testing unified conversation history compaction with AI preference...');
  
  try {
    // Test 1: Build up conversation history
    console.log('\n📝 Test 1: Building up conversation history...');
    const messages = [
      "Hello! I'm testing the unified compaction system.",
      "Can you help me schedule a meeting for tomorrow?",
      "What time would work best for a 1-hour meeting?",
      "I prefer afternoon meetings, around 2 PM.",
      "Great! Can you also remind me to prepare the agenda?",
      "What's the weather like today?",
      "Can you help me with some coding questions?",
      "I'm working on a React project.",
      "How do I handle state management in React?",
      "What's the difference between useState and useReducer?",
      "Can you explain useEffect?",
      "How do I handle forms in React?",
      "What are controlled vs uncontrolled components?",
      "How do I optimize React performance?",
      "What are React hooks best practices?",
      "How do I handle async operations in React?",
      "What's the difference between useCallback and useMemo?",
      "How do I manage global state in React?",
      "What are React context and providers?",
      "How do I handle routing in React?"
    ];

    for (let i = 0; i < messages.length; i++) {
      console.log(`📝 Message ${i + 1}: ${messages[i].substring(0, 50)}...`);
      const result = await makeAIScheduleRequest(messages[i]);
      if (result) {
        console.log(`✅ Response: ${result.aiMessage ? result.aiMessage.substring(0, 50) : 'No message'}...`);
      } else {
        console.log('❌ No response received');
      }
      
      // Small delay between messages
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Test 2: Send a large message that should trigger AI compaction
    console.log('\n🤖 Test 2: Sending large message to trigger AI compaction...');
    const largeMessage = "Now please provide a very detailed analysis of modern web development practices, including all the technologies I mentioned, with examples, best practices, and recommendations. " +
      "This should be comprehensive enough to trigger conversation history compaction. " +
      "Include detailed explanations of each technology, their use cases, advantages, disadvantages, and integration patterns. " +
      "Provide code examples, architectural diagrams, and implementation guidelines. " +
      "Consider performance implications, security concerns, and scalability factors. " +
      "Include best practices for each technology and recommendations for when to use each one. " +
      "Also discuss modern development workflows, CI/CD pipelines, testing strategies, and deployment practices. " +
      "Cover topics like microservices, containerization, cloud platforms, and DevOps practices. " +
      "Include information about monitoring, logging, debugging, and troubleshooting techniques. " +
      "Discuss team collaboration, code review processes, and documentation standards. ".repeat(10);
    
    console.log(`📝 Sending large message (${largeMessage.length} characters)...`);
    const result = await makeAIScheduleRequest(largeMessage);
    
    if (result) {
      console.log(`✅ Response received: ${result.aiMessage ? result.aiMessage.substring(0, 200) : 'No message'}...`);
    } else {
      console.log('❌ No response received');
    }

    // Test 3: Send another message to see if compaction worked
    console.log('\n📝 Test 3: Sending follow-up message to verify compaction...');
    const followUpMessage = "Based on our conversation, can you summarize what we've discussed about React development?";
    const followUpResult = await makeAIScheduleRequest(followUpMessage);
    
    if (followUpResult) {
      console.log(`✅ Follow-up response: ${followUpResult.aiMessage ? followUpResult.aiMessage.substring(0, 200) : 'No message'}...`);
    } else {
      console.log('❌ No follow-up response received');
    }

    console.log('\n✅ All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testUnifiedCompaction(); 